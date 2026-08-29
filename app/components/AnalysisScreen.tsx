import {
  evaluateComprehensiveDiagnosis,
  type CandidateDetail,
  type ComprehensiveDiagnosis,
} from "@/lib/comprehensive-diagnosis";
import { buildFakeUsageSeries } from "@/lib/fake-timeseries";
import { buildFakeRecommendation, type RecommendationResource } from "@/lib/recommendation";
import {
  type DiskIoStatus,
  type OverloadStatus,
  type PerformanceStatus,
  type RamStatus,
} from "@/lib/performance-status";
import { UsageGraph } from "./UsageGraph";

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

function primaryResourceOf(diagnosis: ComprehensiveDiagnosis): RecommendationResource | null {
  if (diagnosis.kind === "single-primary") return diagnosis.primary.resource;
  if (diagnosis.kind === "tied-primary") return diagnosis.candidates[0]?.resource ?? null;
  return null;
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
  status,
  isLoading,
  onRequestReanalysis,
  onBackToStart,
}: {
  status: PerformanceStatus | null;
  isLoading: boolean;
  onRequestReanalysis: () => void;
  onBackToStart: () => void;
}) {
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

      {!isLoading && status !== null && status.status === "received" && (() => {
        const diagnosis = evaluateComprehensiveDiagnosis(status);
        const currentValues = {
          cpu: status.cpuPercent,
          ram: status.ram?.percent ?? null,
          disk: status.disk?.activePercent ?? null,
        };
        const series = buildFakeUsageSeries(currentValues);
        const primaryCandidate =
          diagnosis.kind === "single-primary"
            ? diagnosis.primary
            : diagnosis.kind === "tied-primary"
              ? diagnosis.candidates[0]
              : null;
        const recommendation = buildFakeRecommendation(primaryResourceOf(diagnosis));

        return (
          <>
            <section className="panel panel-diagnosis">
              <h2>종합 진단</h2>
              {renderComprehensiveDiagnosis(diagnosis)}
            </section>

            <section className="panel panel-graph">
              <h2>실시간 사용량 (예시)</h2>
              <UsageGraph
                title="CPU / RAM / Disk 사용량 추이"
                series={series}
                currentValues={currentValues}
                evidenceNote={primaryCandidate ? formatCandidateEvidence(primaryCandidate) : null}
              />
            </section>

            <section className="panel panel-recommendation">
              <h2>지금 해볼 것 (예시)</h2>
              <p className="muted">아직 준비 중인 기능입니다 — 직접 확인해볼 수 있는 행동만 안내합니다.</p>
              <p className="recommendation-title">{recommendation.title}</p>
              {recommendation.steps.length > 0 && (
                <ul>
                  {recommendation.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              )}
            </section>

            <section className="panel panel-cta">
              <button className="button button-primary" onClick={onRequestReanalysis}>
                조치 후 다시 분석
              </button>
            </section>

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
          </>
        );
      })()}
    </main>
  );
}
