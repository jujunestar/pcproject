import { useEffect, useState } from "react";
import { compareDiagnosis, hasNewMeasurement, type CandidateChangeKind } from "@/lib/comparison";
import { appendSampleIfNew, toUsageSeriesPoints, type LiveSample } from "@/lib/live-samples";
import { PollingController } from "@/lib/polling-controller";
import { fetchPerformanceStatus, type PerformanceStatus } from "@/lib/performance-status";
import { UsageGraph } from "./UsageGraph";

type ReceivedStatus = Extract<PerformanceStatus, { status: "received" }>;

const POLL_INTERVAL_MS = 2000;
// 15회 * 2000ms = 최대 30초. "짧게 기다리되 무한 polling 금지" — 이
// 시간 안에 새 measuredAt이 오지 않으면 조용히 포기하고 재시도 버튼을
// 보여준다.
const MAX_ATTEMPTS = 15;
const MAX_AFTER_SAMPLES = 20;

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
  onStatusUpdate,
  onBackToAnalysis,
}: {
  code: string;
  previousStatus: PerformanceStatus | null;
  onStatusUpdate: (status: PerformanceStatus) => void;
  onBackToAnalysis: () => void;
}) {
  const [before, setBefore] = useState<ReceivedStatus | null>(
    previousStatus !== null && previousStatus.status === "received" ? previousStatus : null
  );
  const [retryToken, setRetryToken] = useState(0);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "waiting" });

  // "조치 후 다시 분석"을 누른 시점(또는 화면 안에서 "다시 분석"을 다시
  // 누른 시점)마다, before의 measuredAt과 다른 진짜 새 측정값이 올
  // 때까지 짧게(최대 30초) 확인한다. Redis에 아직 남아있는 예전 값을
  // 그대로 After로 오인하지 않기 위함이다 — hasNewMeasurement 참고.
  useEffect(() => {
    if (before === null || code === "") return;

    setOutcome({ kind: "waiting" });
    let afterSeries: LiveSample[] = [];
    let attempts = 0;
    let stopped = false;

    async function tick() {
      if (stopped) return;
      const result = await fetchPerformanceStatus(code);
      if (stopped) return;

      if (result.status === "received") {
        afterSeries = appendSampleIfNew(afterSeries, result, MAX_AFTER_SAMPLES);
      }

      if (before !== null && hasNewMeasurement(before, result)) {
        onStatusUpdate(result);
        setOutcome({ kind: "ready", after: result, afterSeries });
        stopped = true;
        controller.stop();
        return;
      }

      attempts += 1;
      if (attempts >= MAX_ATTEMPTS) {
        setOutcome({ kind: "stalled" });
        stopped = true;
        controller.stop();
      }
    }

    const controller = new PollingController({ intervalMs: POLL_INTERVAL_MS, onTick: tick });
    controller.start();

    return () => {
      stopped = true;
      controller.stop();
    };
  }, [before, retryToken, code, onStatusUpdate]);

  return (
    <main className="screen screen-compare">
      <button className="link-button" onClick={onBackToAnalysis}>
        ← 성능 분석 결과
      </button>

      <section className="panel">
        <h1>조치 전후 비교</h1>
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
          const beforeSeries = appendSampleIfNew([], before, 1);

          return (
            <>
              <section className="panel panel-diagnosis">
                <h2>가장 큰 변화</h2>
                {comparison.headlineChange ? (
                  <>
                    <p className="diagnosis-headline">
                      {comparison.headlineChange.label} {comparison.headlineChange.beforeValueLabel} →{" "}
                      {comparison.headlineChange.afterValueLabel}
                    </p>
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
                <button className="button button-primary" onClick={() => setBefore(after)}>
                  다시 분석
                </button>
              </section>
            </>
          );
        })()}
    </main>
  );
}
