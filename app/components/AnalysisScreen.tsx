import { useEffect, useState } from "react";
import {
  evaluateComprehensiveDiagnosis,
  type CandidateDetail,
  type ComprehensiveDiagnosis,
} from "@/lib/comprehensive-diagnosis";
import {
  appendSampleIfNew,
  shouldShowConnectionWarning,
  toUsageSeriesPoints,
  type LiveSample,
} from "@/lib/live-samples";
import { PollingController } from "@/lib/polling-controller";
import { buildRecommendation } from "@/lib/recommendation";
import {
  fetchPerformanceStatus,
  type DiskIoStatus,
  type OverloadStatus,
  type PerformanceStatus,
  type RamStatus,
} from "@/lib/performance-status";
import { THRESHOLD_PERCENT, UsageGraph } from "./UsageGraph";

const POLL_INTERVAL_MS = 2000;
const MAX_SAMPLES = 20;

const STATUS_TEXT: Record<Exclude<PerformanceStatus["status"], "received">, string> = {
  "invalid-code": "잘못된 연결 코드 형식",
  "no-data": "아직 수신된 데이터 없음 — Agent가 데이터를 올릴 때까지 기다려보세요.",
  "fetch-failed": "조회 실패 — 네트워크 상태를 확인해보세요.",
  "invalid-format": "데이터 형식을 확인할 수 없음",
};

const OVERLOAD_STATUS_TEXT: Record<OverloadStatus, string> = {
  "insufficient-data": "데이터 부족",
  normal: "CPU 과부하 근거 없음",
  "overload-candidate": "CPU 과부하 후보",
};

const RAM_STATUS_TEXT: Record<RamStatus, string> = {
  "insufficient-data": "데이터 부족",
  normal: "RAM 병목 근거 없음",
  "bottleneck-candidate": "RAM 병목 후보",
};

const DISK_IO_STATUS_TEXT: Record<DiskIoStatus, string> = {
  "insufficient-data": "데이터 부족",
  normal: "Disk I/O 병목 근거 없음",
  "bottleneck-candidate": "Disk I/O 병목 후보",
};

function formatBytesAsGB(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}
function formatBytesAsMB(bytes: number): string {
  return (bytes / 1024 ** 2).toFixed(1);
}

function formatCandidateEvidence(candidate: CandidateDetail): string {
  return `${candidate.label} — 최고 ${candidate.maxValueLabel}, ${new Date(candidate.startedAt).toLocaleTimeString()}~${new Date(candidate.endedAt).toLocaleTimeString()} (${candidate.durationSeconds.toFixed(1)}초 지속)`;
}

function renderCandidateDetail(candidate: CandidateDetail) {
  return (
    <div key={candidate.resource} className="candidate-detail">
      <p>{formatCandidateEvidence(candidate)}</p>
      {candidate.topProcessSummary && <p className="muted">관련 프로세스 후보: {candidate.topProcessSummary}</p>}
    </div>
  );
}

function renderComprehensiveDiagnosis(diagnosis: ComprehensiveDiagnosis) {
  return (
    <>
      <p className="diagnosis-headline">{diagnosis.headline}</p>

      {diagnosis.kind === "single-primary" && (
        <>
          {renderCandidateDetail(diagnosis.primary)}
          {diagnosis.secondaryCandidates.length > 0 && (
            <>
              <p className="muted">동시에 감지된 병목 후보</p>
              {diagnosis.secondaryCandidates.map(renderCandidateDetail)}
            </>
          )}
        </>
      )}

      {diagnosis.kind === "tied-primary" && diagnosis.candidates.map(renderCandidateDetail)}

      {(diagnosis.kind === "single-primary" || diagnosis.kind === "tied-primary") &&
        diagnosis.others.map((other) => (
          <p key={other.resource} className="muted">
            {other.label}: {other.shortSummary}
          </p>
        ))}

      {diagnosis.kind === "no-candidate" &&
        diagnosis.resources.map((resource) => (
          <p key={resource.resource} className="muted">
            {resource.label}: {resource.shortSummary}
          </p>
        ))}
    </>
  );
}

function LoadingBody() {
  return (
    <section className="panel panel-loading">
      <p className="diagnosis-headline">PC 상태를 측정 중입니다…</p>
      <div className="loading-grid">
        <div className="loading-card">CPU 측정 중</div>
        <div className="loading-card">RAM 측정 중</div>
        <div className="loading-card">Disk 측정 중</div>
      </div>
    </section>
  );
}

export function AnalysisScreen({
  code,
  status,
  isLoading,
  onStatusUpdate,
  onSamplesChange,
  onRequestReanalysis,
  onBackToStart,
}: {
  code: string;
  status: PerformanceStatus | null;
  isLoading: boolean;
  onStatusUpdate: (status: PerformanceStatus) => void;
  onSamplesChange: (samples: LiveSample[]) => void;
  onRequestReanalysis: () => void;
  onBackToStart: () => void;
}) {
  const [samples, setSamples] = useState<LiveSample[]>([]);
  const [consecutiveFailureCount, setConsecutiveFailureCount] = useState(0);

  // 화면③이 "조치 전" 그래프에 이 화면에서 이미 수집한 실제 시계열을
  // 그대로 재사용할 수 있도록, samples가 바뀔 때마다 부모(page.tsx)에도
  // 알려준다. onSamplesChange는 page.tsx에서 useState의 raw setter를
  // 그대로 넘겨주는 안정적인(레퍼런스가 안 바뀌는) 함수라, 이 effect가
  // 매 렌더마다 다시 실행되는 문제는 없다.
  useEffect(() => {
    onSamplesChange(samples);
  }, [samples, onSamplesChange]);

  // 화면②를 보고 있고(mount) + 최초 로딩이 끝났고 + 탭이 visible인 동안만
  // 2000ms 간격으로 최신 데이터를 확인한다. 코드/구현 근거는
  // docs/slices/real-time-performance-graph.md 참고. isLoading이 아직
  // true인 최초 진입 시점에는 폴링을 시작하지 않는다 — 그 최초 1회
  // 조회는 이미 부모(page.tsx)가 수행한다.
  useEffect(() => {
    if (isLoading || code === "") return;

    async function tick() {
      const result = await fetchPerformanceStatus(code);
      if (result.status === "received") {
        onStatusUpdate(result);
        setSamples((prev) => appendSampleIfNew(prev, result, MAX_SAMPLES));
        setConsecutiveFailureCount(0);
      } else if (result.status !== "no-data") {
        // no-data는 "아직 값이 없는 정상 대기 상태"라 실패로 세지 않는다.
        setConsecutiveFailureCount((prev) => prev + 1);
      }
    }

    const controller = new PollingController({ intervalMs: POLL_INTERVAL_MS, onTick: tick });

    function handleVisibilityChange() {
      controller.setVisible(!document.hidden);
    }

    controller.setVisible(!document.hidden);
    controller.start();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      controller.stop();
    };
  }, [isLoading, code, onStatusUpdate]);

  const showConnectionWarning = shouldShowConnectionWarning(consecutiveFailureCount);

  return (
    <main className="screen screen-analysis">
      <button className="link-button" onClick={onBackToStart}>
        ← 시작 화면
      </button>

      {isLoading && <LoadingBody />}

      {!isLoading && status === null && (
        <section className="panel">
          <p className="diagnosis-headline">아직 분석을 시작하지 않았습니다.</p>
        </section>
      )}

      {!isLoading && status !== null && status.status !== "received" && (
        <section className="panel">
          <p className="diagnosis-headline">{STATUS_TEXT[status.status]}</p>
        </section>
      )}

      {showConnectionWarning && (
        <section className="panel panel-warning">
          <p className="muted">연결 불안정 — 최신 값을 다시 확인하는 중입니다. 화면은 마지막으로 확인된 값을 보여주고 있습니다.</p>
        </section>
      )}

      {!isLoading && status !== null && status.status === "received" && (() => {
        const diagnosis = evaluateComprehensiveDiagnosis(status);
        const currentValues = {
          cpu: status.cpuPercent,
          ram: status.ram?.percent ?? null,
          disk: status.disk?.activePercent ?? null,
        };
        const series = toUsageSeriesPoints(samples);
        const primaryCandidate =
          diagnosis.kind === "single-primary"
            ? diagnosis.primary
            : diagnosis.kind === "tied-primary"
              ? diagnosis.candidates[0]
              : null;
        const recommendation = buildRecommendation(diagnosis);

        return (
          <>
            <section className="panel panel-diagnosis">
              <div className="page-heading">
                <div>
                  <p className="eyebrow">REAL-TIME PERFORMANCE MONITORING</p>
                  <h1>성능 분석</h1>
                  <p className="muted">최신 시스템 측정값을 기반으로 병목 후보를 분석합니다.</p>
                </div>
                <span className="live-status"><span className="live-dot" /> 실시간 측정 중</span>
              </div>
              <h2>종합 진단</h2>
              {renderComprehensiveDiagnosis(diagnosis)}
            </section>

            <section className="resource-summary-grid" aria-label="현재 리소스 사용량">
              <article className="resource-summary-card resource-cpu">
                <p>CPU 사용량</p>
                <strong>{status.cpuPercent.toFixed(1)}%</strong>
                <span>{OVERLOAD_STATUS_TEXT[status.overloadStatus]}</span>
              </article>
              <article className="resource-summary-card resource-ram">
                <p>메모리 사용량</p>
                <strong>{status.ram?.percent !== null && status.ram?.percent !== undefined ? `${status.ram.percent.toFixed(1)}%` : "-"}</strong>
                <span>{status.ram === null ? "데이터 부족" : RAM_STATUS_TEXT[status.ram.status]}</span>
              </article>
              <article className="resource-summary-card resource-disk">
                <p>Disk 활성 시간</p>
                <strong>{status.disk?.activePercent !== null && status.disk?.activePercent !== undefined ? `${status.disk.activePercent.toFixed(1)}%` : "-"}</strong>
                <span>{status.disk === null ? "데이터 부족" : DISK_IO_STATUS_TEXT[status.disk.ioStatus]}</span>
              </article>
            </section>

            <div className="analysis-insights-grid">
            <section className="panel panel-graph">
              <h2>실시간 사용량</h2>
              <p className="muted">최신 측정값을 자동으로 확인하고 있습니다.</p>
              {samples.length === 0 ? (
                <p className="muted">샘플 수집 중… (곧 첫 측정값이 표시됩니다)</p>
              ) : (
                <UsageGraph
                  title="CPU / RAM / Disk 사용량 추이"
                  series={series}
                  currentValues={currentValues}
                  evidenceNote={primaryCandidate ? formatCandidateEvidence(primaryCandidate) : null}
                  caption={`실제 측정값 · 점선: 병목 기준 ${THRESHOLD_PERCENT}%`}
                />
              )}
            </section>

            <section className="panel panel-recommendation">
              <h2>지금 해볼 것</h2>
              <p className="recommendation-title">{recommendation.title}</p>
              {recommendation.steps.length > 0 && (
                <ul>
                  {recommendation.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              )}
            </section>
            </div>

            <section className="panel panel-cta">
              <button className="button button-primary" onClick={onRequestReanalysis}>
                조치 후 다시 분석
              </button>
            </section>

            <div className="detail-grid">
            <section className="panel panel-detail">
              <h2>CPU</h2>
              <p>상태: {OVERLOAD_STATUS_TEXT[status.overloadStatus]}</p>
              <p>CPU 사용률: {status.cpuPercent.toFixed(1)}%</p>
              <p className="muted">마지막 측정: {new Date(status.measuredAt).toLocaleString()}</p>
              {status.overloadStatus === "overload-candidate" && status.overloadEvidence && (
                <p>
                  판정 근거: 최고 {status.overloadEvidence.maxCpuPercent.toFixed(1)}%,{" "}
                  {new Date(status.overloadEvidence.startedAt).toLocaleTimeString()} ~{" "}
                  {new Date(status.overloadEvidence.endedAt).toLocaleTimeString()} (
                  {status.overloadEvidence.durationSeconds.toFixed(1)}초 지속)
                </p>
              )}
              {status.overloadStatus === "overload-candidate" && status.topProcess && (
                <p>
                  관련 프로세스 후보: {status.topProcess.name} (PID {status.topProcess.pid}, CPU{" "}
                  {status.topProcess.cpuPercent.toFixed(1)}%)
                </p>
              )}
            </section>

            <section className="panel panel-detail">
              <h2>RAM</h2>
              {status.ram === null ? (
                <p>상태: 데이터 부족</p>
              ) : (
                <>
                  <p>상태: {RAM_STATUS_TEXT[status.ram.status]}</p>
                  {status.ram.percent !== null && <p>RAM 사용률: {status.ram.percent.toFixed(1)}%</p>}
                  {status.ram.usedBytes !== null && <p>사용 중 메모리: {formatBytesAsGB(status.ram.usedBytes)}GB</p>}
                  {status.ram.availableBytes !== null && (
                    <p>사용 가능한 메모리: {formatBytesAsGB(status.ram.availableBytes)}GB</p>
                  )}
                  {status.ram.status === "bottleneck-candidate" && status.ram.evidence && (
                    <p>
                      판정 근거: 최고 {status.ram.evidence.maxRamPercent.toFixed(1)}%,{" "}
                      {new Date(status.ram.evidence.startedAt).toLocaleTimeString()} ~{" "}
                      {new Date(status.ram.evidence.endedAt).toLocaleTimeString()} (
                      {status.ram.evidence.durationSeconds.toFixed(1)}초 지속)
                    </p>
                  )}
                  {status.ram.status === "bottleneck-candidate" && status.ram.topProcess && (
                    <p>
                      RAM 사용량이 높은 프로세스 후보: {status.ram.topProcess.name} (PID{" "}
                      {status.ram.topProcess.pid}, {formatBytesAsMB(status.ram.topProcess.rss)}MB)
                    </p>
                  )}
                </>
              )}
            </section>

            <section className="panel panel-detail">
              <h2>Disk</h2>
              {status.disk === null ? (
                <p>상태: 데이터 부족</p>
              ) : (
                <>
                  {status.disk.capacity && (
                    <p>
                      용량 사용률: {status.disk.capacity.percent.toFixed(1)}% (
                      {formatBytesAsGB(status.disk.capacity.usedBytes)}GB / {formatBytesAsGB(status.disk.capacity.totalBytes)}GB)
                    </p>
                  )}
                  <p>I/O 상태: {DISK_IO_STATUS_TEXT[status.disk.ioStatus]}</p>
                  {status.disk.activePercent !== null && <p>Disk 활성 시간: {status.disk.activePercent.toFixed(1)}%</p>}
                  {status.disk.ioStatus === "bottleneck-candidate" && status.disk.ioEvidence && (
                    <p>
                      판정 근거: 최고 {status.disk.ioEvidence.maxDiskActivePercent.toFixed(1)}%,{" "}
                      {new Date(status.disk.ioEvidence.startedAt).toLocaleTimeString()} ~{" "}
                      {new Date(status.disk.ioEvidence.endedAt).toLocaleTimeString()} (
                      {status.disk.ioEvidence.durationSeconds.toFixed(1)}초 지속)
                    </p>
                  )}
                  {status.disk.ioStatus === "bottleneck-candidate" && status.disk.topIoProcess && (
                    <p>
                      Disk I/O가 높은 관련 프로세스 후보: {status.disk.topIoProcess.name} (PID{" "}
                      {status.disk.topIoProcess.pid}, {(status.disk.topIoProcess.bytesPerSec / 1024).toFixed(1)}KB/s)
                    </p>
                  )}
                </>
              )}
            </section>
            </div>
          </>
        );
      })()}
    </main>
  );
}
