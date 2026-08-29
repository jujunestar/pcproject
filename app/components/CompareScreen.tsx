import { useEffect, useRef, useState } from "react";
import { compareDiagnosis, hasNewMeasurement, type CandidateChangeKind } from "@/lib/comparison";
import { appendSampleIfNew, toUsageSeriesPoints, type LiveSample } from "@/lib/live-samples";
import { PollingController } from "@/lib/polling-controller";
import { fetchPerformanceStatus, type PerformanceStatus } from "@/lib/performance-status";
import { UsageGraph } from "./UsageGraph";

type ReceivedStatus = Extract<PerformanceStatus, { status: "received" }>;

const POLL_INTERVAL_MS = 2000;
// 15회 * 2000ms = 최대 30초. "짧게 기다리되 무한 polling 금지" — 이
// 시간 안에 새 measuredAt이 처음 도착하지 않으면 조용히 포기하고
// 재시도 버튼을 보여준다.
const MAX_ATTEMPTS = 15;
// 새 measuredAt을 "처음" 찾은 뒤에도, 그래프가 실제 변화를 보여줄 수
// 있도록 서로 다른 sample을 몇 개 더 모은다(목표 3개). 다만 이것도
// 무한정 기다리지 않도록 추가로 최대 5회(10초)까지만 더 기다린다.
const TARGET_AFTER_SAMPLES = 3;
const MAX_EXTRA_ATTEMPTS = 5;
const MAX_AFTER_SAMPLES = 20;
const MAX_BEFORE_SAMPLES = 20;

type Outcome =
  | { kind: "waiting" }
  | { kind: "ready"; after: ReceivedStatus; afterSeries: LiveSample[] }
  | { kind: "stalled" };

const CANDIDATE_CHANGE_TEXT: Record<CandidateChangeKind, string> = {
  "detected-to-cleared": "현재 측정에서는 병목 후보가 더 이상 관찰되지 않습니다",
  "normal-to-candidate": "정상 → 병목 후보로 새로 관찰됨",
  "unchanged-candidate": "병목 후보 유지",
  "unchanged-normal": "정상 유지",
  "insufficient-data": "데이터 부족으로 비교 불가",
};

const DIRECTION_TEXT: Record<"improved" | "worsened" | "unchanged" | "unknown", string> = {
  improved: "개선",
  worsened: "악화",
  unchanged: "변화 없음",
  unknown: "비교 불가",
};

function usageValuesOf(status: ReceivedStatus) {
  return {
    cpu: status.cpuPercent,
    ram: status.ram?.percent ?? null,
    disk: status.disk?.activePercent ?? null,
  };
}

export function CompareScreen({
  code,
  previousStatus,
  previousSamples,
  onStatusUpdate,
  onBackToAnalysis,
}: {
  code: string;
  previousStatus: PerformanceStatus | null;
  previousSamples: LiveSample[];
  onStatusUpdate: (status: PerformanceStatus) => void;
  onBackToAnalysis: () => void;
}) {
  const [before, setBefore] = useState<ReceivedStatus | null>(
    previousStatus !== null && previousStatus.status === "received" ? previousStatus : null
  );
  // 화면②에서 이미 수집된 실제 시계열(previousSamples)을 Before
  // 그래프에 그대로 재사용한다. before 값 자체가 이미 그 시계열의
  // 마지막 항목과 같은 measuredAt일 것이므로(같은 상태 객체), 표의
  // Before 대표값과 그래프의 마지막 점이 항상 일치하도록 before를
  // 다시 한 번 append해서 보정한다(이미 마지막이면 중복 추가되지
  // 않는다 — appendSampleIfNew 참고).
  const [beforeSeries, setBeforeSeries] = useState<LiveSample[]>(() =>
    before !== null ? appendSampleIfNew(previousSamples, before, MAX_BEFORE_SAMPLES) : []
  );
  const [retryToken, setRetryToken] = useState(0);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "waiting" });

  // onStatusUpdate(page.tsx의 handleCompareStatusUpdate)는 useCallback
  // 없이 매 렌더마다 새로 만들어지는 함수다. 이걸 그대로 아래 폴링
  // useEffect의 의존성 배열에 넣으면, Home이 이 화면과 무관한 이유로
  // 재렌더링될 때마다(예: 다른 화면의 stray 콜백) 폴링 effect가
  // 통째로 재시작되어 attempts가 0으로 리셋되고 30초 타임아웃이
  // 영원히 완주되지 못한다(실제 production 버그, 재현 테스트로 확인함
  // — app/components/CompareScreen.polling.test.tsx). ref에 최신
  // 콜백만 담아두고, 폴링 effect는 이 ref를 통해서만 호출해 콜백
  // 레퍼런스 변경이 폴링 재시작을 유발하지 않게 한다.
  const onStatusUpdateRef = useRef(onStatusUpdate);
  useEffect(() => {
    onStatusUpdateRef.current = onStatusUpdate;
  }, [onStatusUpdate]);

  // "조치 후 다시 분석"을 누른 시점(또는 화면 안에서 "다시 분석"을 다시
  // 누른 시점)마다, before의 measuredAt과 다른 진짜 새 측정값이 올
  // 때까지 짧게(최대 30초) 확인한다. Redis에 아직 남아있는 예전 값을
  // 그대로 After로 오인하지 않기 위함이다 — hasNewMeasurement 참고.
  useEffect(() => {
    if (before === null || code === "") return;

    setOutcome({ kind: "waiting" });
    let afterSeries: LiveSample[] = [];
    let latestAfterStatus: ReceivedStatus | null = null;
    let foundNewMeasurement = false;
    // 전환(새 measuredAt을 처음 찾은 시점) 이전에도 afterSeries에는
    // before와 같은 값의 "대기 중" 점이 하나 남아있을 수 있다. 목표
    // 3개는 그 대기 중 점을 세지 않고, 전환 이후 새로 쌓인 서로 다른
        // sample 개수만 센다 — 그래서 baselineLength를 전환 시점에
    // 따로 기록해둔다.
    let baselineLength = 0;
    let attempts = 0;
    let extraAttempts = 0;
    let stopped = false;

    function finalize() {
      if (latestAfterStatus === null) return;
      onStatusUpdateRef.current(latestAfterStatus);
      setOutcome({ kind: "ready", after: latestAfterStatus, afterSeries });
      stopped = true;
      controller.stop();
    }

    async function tick() {
      if (stopped) return;
      const result = await fetchPerformanceStatus(code);
      if (stopped) return;

      if (result.status === "received") {
        afterSeries = appendSampleIfNew(afterSeries, result, MAX_AFTER_SAMPLES);
      }

      if (!foundNewMeasurement) {
        if (result.status === "received" && before !== null && hasNewMeasurement(before, result)) {
          foundNewMeasurement = true;
          latestAfterStatus = result;
          // 방금 추가된 이 새 sample 자체는 "전환 이후 수집분" 1개로
          // 친다 — afterSeries.length - baselineLength가 이 tick에서
          // 정확히 1이 되도록 기준선을 하나 앞에 둔다.
          baselineLength = afterSeries.length - 1;
        } else {
          attempts += 1;
          if (attempts >= MAX_ATTEMPTS) {
            setOutcome({ kind: "stalled" });
            stopped = true;
            controller.stop();
          }
          return;
        }
      } else if (result.status === "received") {
        latestAfterStatus = result;
      }

      // 새 measuredAt은 이미 찾았다 — 그래프가 실제 변화를 보여줄 수
      // 있도록 전환 이후로 서로 다른 sample을 TARGET_AFTER_SAMPLES개까지
      // 더 모은다. 다만 이 단계도 무한정 기다리지 않는다.
      extraAttempts += 1;
      const collectedSinceTransition = afterSeries.length - baselineLength;
      if (collectedSinceTransition >= TARGET_AFTER_SAMPLES || extraAttempts >= MAX_EXTRA_ATTEMPTS) {
        finalize();
      }
    }

    const controller = new PollingController({ intervalMs: POLL_INTERVAL_MS, onTick: tick });
    controller.start();

    return () => {
      stopped = true;
      controller.stop();
    };
    // onStatusUpdate는 의도적으로 제외한다 — 위 ref로만 접근해서 콜백
    // 레퍼런스가 바뀌어도 이 폴링 자체는 재시작되지 않게 한다.
  }, [before, retryToken, code]);

  return (
    <main className="screen screen-compare">
      <header className="workspace-header">
        <div className="workspace-brand"><span>⌁</span><strong>TracePC</strong></div>
        <button className="link-button" onClick={onBackToAnalysis}>성능 분석 결과</button>
      </header>

      <section className="panel">
        <div className="page-heading">
          <div>
            <p className="eyebrow">MEASUREMENT COMPARISON</p>
            <h1>조치 전후 비교</h1>
            <p className="muted">새로운 실제 측정값으로 변화와 병목 상태를 비교합니다.</p>
          </div>
          <span className="comparison-arrow">Before <b>→</b> After</span>
        </div>
      </section>

      {before === null && (
        <section className="panel panel-empty">
          <p className="diagnosis-headline">비교할 이전 분석 결과가 없습니다.</p>
          <p className="muted">
            성능 분석 결과 화면에서 &quot;조치 후 다시 분석&quot;을 눌러야 비교를 시작할 수 있습니다.
          </p>
        </section>
      )}

      {before !== null && outcome.kind === "waiting" && (
        <section className="panel panel-loading">
          <p className="diagnosis-headline">새 측정값을 기다리는 중입니다…</p>
          <p className="muted">화면을 그대로 두면 자동으로 확인됩니다.</p>
        </section>
      )}

      {before !== null && outcome.kind === "stalled" && (
        <section className="panel panel-empty">
          <p className="diagnosis-headline">아직 새로운 측정값이 도착하지 않았습니다.</p>
          <p className="muted">Agent가 계속 실행 중인지 확인한 뒤 다시 시도해보세요.</p>
          <button className="button button-secondary" onClick={() => setRetryToken((t) => t + 1)}>
            다시 시도
          </button>
        </section>
      )}

      {before !== null &&
        outcome.kind === "ready" &&
        (() => {
          const after = outcome.after;
          const comparison = compareDiagnosis(before, after);
          const beforeValues = usageValuesOf(before);
          const afterValues = usageValuesOf(after);

          return (
            <>
              <section className="panel panel-diagnosis panel-comparison-summary">
                <h2>가장 큰 변화</h2>
                {comparison.headlineChange ? (
                  <>
                    <div className="comparison-metric-hero">
                      <div>
                        <span>Before · {comparison.headlineChange.label}</span>
                        <strong>{comparison.headlineChange.beforeValueLabel}</strong>
                      </div>
                      <b className="comparison-metric-arrow">→</b>
                      <div>
                        <span>After · {comparison.headlineChange.label}</span>
                        <strong>{comparison.headlineChange.afterValueLabel}</strong>
                      </div>
                    </div>
                    <p className="muted">{CANDIDATE_CHANGE_TEXT[comparison.headlineChange.candidateChange]}</p>
                  </>
                ) : (
                  <p className="diagnosis-headline">비교할 만한 변화가 없습니다.</p>
                )}
                <p className="overall-message">{comparison.overallMessage}</p>
              </section>

              <section className="panel panel-graph panel-graph-compare">
                <h2>Before / After</h2>
                <div className="compare-graph-grid">
                  <UsageGraph
                    title="Before"
                    series={toUsageSeriesPoints(beforeSeries)}
                    currentValues={beforeValues}
                    caption="실제 측정값 (조치 전)"
                  />
                  <UsageGraph
                    title="After"
                    series={toUsageSeriesPoints(outcome.afterSeries)}
                    currentValues={afterValues}
                    caption="실제 측정값 (조치 후)"
                  />
                </div>
              </section>

              <section className="panel panel-detail">
                <h2>CPU / RAM / Disk Before → After</h2>
                <table className="compare-table">
                  <thead>
                    <tr>
                      <th>리소스</th>
                      <th>Before</th>
                      <th>After</th>
                      <th>변화</th>
                      <th>병목 후보 변화</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.resourceChanges.map((change) => (
                      <tr key={change.resource}>
                        <td>{change.label}</td>
                        <td>{change.beforeValueLabel}</td>
                        <td>{change.afterValueLabel}</td>
                        <td>{DIRECTION_TEXT[change.direction]}</td>
                        <td>{CANDIDATE_CHANGE_TEXT[change.candidateChange]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section className="panel panel-cta">
                <button
                  className="button button-primary"
                  onClick={() => {
                    // 이번 회차의 After 실측 시계열이 다음 회차의 Before가
                    // 된다 — fake 데이터를 새로 만들지 않는다.
                    setBeforeSeries(outcome.afterSeries);
                    setBefore(after);
                  }}
                >
                  다시 분석
                </button>
              </section>
            </>
          );
        })()}
    </main>
  );
}
