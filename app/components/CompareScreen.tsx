import { compareDiagnosis, type CandidateChangeKind } from "@/lib/comparison";
import { buildFakeUsageSeries } from "@/lib/fake-timeseries";
import type { PerformanceStatus } from "@/lib/performance-status";
import { UsageGraph } from "./UsageGraph";

type ReceivedStatus = Extract<PerformanceStatus, { status: "received" }>;

const CANDIDATE_CHANGE_TEXT: Record<CandidateChangeKind, string> = {
  "detected-to-cleared": "병목 후보 → 현재 측정에서는 발견되지 않음",
  "normal-to-candidate": "정상 → 병목 후보로 새로 감지됨",
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

function isReceived(status: PerformanceStatus | null): status is ReceivedStatus {
  return status !== null && status.status === "received";
}

export function CompareScreen({
  previousStatus,
  currentStatus,
  isLoading,
  onReanalyze,
  onBackToAnalysis,
}: {
  previousStatus: PerformanceStatus | null;
  currentStatus: PerformanceStatus | null;
  isLoading: boolean;
  onReanalyze: () => void;
  onBackToAnalysis: () => void;
}) {
  return (
    <main className="screen screen-compare">
      <button className="link-button" onClick={onBackToAnalysis}>
        ← 성능 분석 결과
      </button>

      <section className="panel">
        <h1>조치 전후 비교</h1>
      </section>

      {previousStatus === null && (
        <section className="panel panel-empty">
          <p className="diagnosis-headline">비교할 이전 분석 결과가 없습니다.</p>
          <p className="muted">
            성능 분석 결과 화면에서 &quot;조치 후 다시 분석&quot;을 눌러야 비교를 시작할 수 있습니다.
          </p>
        </section>
      )}

      {previousStatus !== null && !isReceived(previousStatus) && (
        <section className="panel panel-empty">
          <p className="diagnosis-headline">이전 분석 결과를 비교할 수 없는 상태입니다.</p>
        </section>
      )}

      {previousStatus !== null && isReceived(previousStatus) && isLoading && (
        <section className="panel panel-loading">
          <p className="diagnosis-headline">다시 측정 중입니다…</p>
        </section>
      )}

      {previousStatus !== null && isReceived(previousStatus) && !isLoading && !isReceived(currentStatus) && (
        <section className="panel">
          <p className="diagnosis-headline">아직 현재 분석 결과를 받지 못했습니다.</p>
        </section>
      )}

      {previousStatus !== null &&
        isReceived(previousStatus) &&
        !isLoading &&
        isReceived(currentStatus) &&
        (() => {
          const comparison = compareDiagnosis(previousStatus, currentStatus);
          const previousValues = usageValuesOf(previousStatus);
          const currentValues = usageValuesOf(currentStatus);

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
                <h2>Before / After (예시)</h2>
                <div className="compare-graph-grid">
                  <UsageGraph
                    title="Before"
                    series={buildFakeUsageSeries(previousValues)}
                    currentValues={previousValues}
                  />
                  <UsageGraph
                    title="After"
                    series={buildFakeUsageSeries(currentValues)}
                    currentValues={currentValues}
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
                <button className="button button-primary" onClick={onReanalyze}>
                  다시 분석
                </button>
              </section>
            </>
          );
        })()}
    </main>
  );
}
