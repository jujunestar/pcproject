import type { PerformanceStatus } from "./performance-status";

type ReceivedStatus = Extract<PerformanceStatus, { status: "received" }>;

export type DiagnosisResourceKey = "cpu" | "ram" | "disk";

export type CandidateDetail = {
  kind: "candidate";
  resource: DiagnosisResourceKey;
  label: string;
  durationSeconds: number;
  maxValueLabel: string;
  startedAt: string;
  endedAt: string;
  topProcessSummary: string | null;
};

export type NonCandidateDetail = {
  kind: "non-candidate";
  resource: DiagnosisResourceKey;
  label: string;
  state: "normal" | "insufficient-data";
  shortSummary: string;
};

export type ComprehensiveDiagnosis =
  | { kind: "insufficient-data"; headline: string }
  | { kind: "no-candidate"; headline: string; resources: NonCandidateDetail[] }
  | {
      kind: "single-primary";
      headline: string;
      primary: CandidateDetail;
      secondaryCandidates: CandidateDetail[];
      others: NonCandidateDetail[];
    }
  | {
      kind: "tied-primary";
      headline: string;
      candidates: CandidateDetail[];
      others: NonCandidateDetail[];
    };

const RESOURCE_LABEL: Record<DiagnosisResourceKey, string> = {
  cpu: "CPU",
  ram: "RAM",
  disk: "Disk",
};

type ResourceEntry = CandidateDetail | NonCandidateDetail;

function buildCpuEntry(status: ReceivedStatus): ResourceEntry {
  const resource: DiagnosisResourceKey = "cpu";
  const label = RESOURCE_LABEL[resource];

  if (status.overloadStatus === "overload-candidate" && status.overloadEvidence) {
    const evidence = status.overloadEvidence;
    return {
      kind: "candidate",
      resource,
      label,
      durationSeconds: evidence.durationSeconds,
      maxValueLabel: `${evidence.maxCpuPercent.toFixed(1)}%`,
      startedAt: evidence.startedAt,
      endedAt: evidence.endedAt,
      topProcessSummary: status.topProcess
        ? `${status.topProcess.name} (PID ${status.topProcess.pid}, CPU ${status.topProcess.cpuPercent.toFixed(1)}%)`
        : null,
    };
  }

  if (status.overloadStatus === "normal") {
    return {
      kind: "non-candidate",
      resource,
      label,
      state: "normal",
      shortSummary: `정상 (${status.cpuPercent.toFixed(1)}%)`,
    };
  }

  return { kind: "non-candidate", resource, label, state: "insufficient-data", shortSummary: "데이터 부족" };
}

function buildRamEntry(status: ReceivedStatus): ResourceEntry {
  const resource: DiagnosisResourceKey = "ram";
  const label = RESOURCE_LABEL[resource];
  const ram = status.ram;

  if (ram !== null && ram.status === "bottleneck-candidate" && ram.evidence) {
    const evidence = ram.evidence;
    return {
      kind: "candidate",
      resource,
      label,
      durationSeconds: evidence.durationSeconds,
      maxValueLabel: `${evidence.maxRamPercent.toFixed(1)}%`,
      startedAt: evidence.startedAt,
      endedAt: evidence.endedAt,
      topProcessSummary: ram.topProcess
        ? `${ram.topProcess.name} (PID ${ram.topProcess.pid}, ${(ram.topProcess.rss / 1024 / 1024).toFixed(1)}MB)`
        : null,
    };
  }

  if (ram !== null && ram.status === "normal") {
    return {
      kind: "non-candidate",
      resource,
      label,
      state: "normal",
      shortSummary: ram.percent !== null ? `정상 (${ram.percent.toFixed(1)}%)` : "정상",
    };
  }

  return { kind: "non-candidate", resource, label, state: "insufficient-data", shortSummary: "데이터 부족" };
}

function buildDiskEntry(status: ReceivedStatus): ResourceEntry {
  const resource: DiagnosisResourceKey = "disk";
  const label = RESOURCE_LABEL[resource];
  const disk = status.disk;

  if (disk !== null && disk.ioStatus === "bottleneck-candidate" && disk.ioEvidence) {
    const evidence = disk.ioEvidence;
    return {
      kind: "candidate",
      resource,
      label,
      durationSeconds: evidence.durationSeconds,
      maxValueLabel: `${evidence.maxDiskActivePercent.toFixed(1)}%`,
      startedAt: evidence.startedAt,
      endedAt: evidence.endedAt,
      topProcessSummary: disk.topIoProcess
        ? `${disk.topIoProcess.name} (PID ${disk.topIoProcess.pid}, ${(disk.topIoProcess.bytesPerSec / 1024).toFixed(1)}KB/s)`
        : null,
    };
  }

  if (disk !== null && disk.ioStatus === "normal") {
    return {
      kind: "non-candidate",
      resource,
      label,
      state: "normal",
      shortSummary: disk.activePercent !== null ? `정상 (${disk.activePercent.toFixed(1)}%)` : "정상",
    };
  }

  return { kind: "non-candidate", resource, label, state: "insufficient-data", shortSummary: "데이터 부족" };
}

function isCandidate(entry: ResourceEntry): entry is CandidateDetail {
  return entry.kind === "candidate";
}

function buildNoCandidateHeadline(nonCandidates: NonCandidateDetail[]): string {
  const normalLabels = nonCandidates.filter((e) => e.state === "normal").map((e) => e.label);
  const insufficientLabels = nonCandidates
    .filter((e) => e.state === "insufficient-data")
    .map((e) => e.label);

  if (insufficientLabels.length === 0) {
    return "측정한 CPU/RAM/Disk 범위에서 병목 후보가 발견되지 않았습니다";
  }
  return `${normalLabels.join(", ")} 정상 확인, ${insufficientLabels.join(", ")} 데이터 부족`;
}

export function evaluateComprehensiveDiagnosis(status: ReceivedStatus): ComprehensiveDiagnosis {
  const entries = [buildCpuEntry(status), buildRamEntry(status), buildDiskEntry(status)];
  const candidates = entries.filter(isCandidate);
  const nonCandidates = entries.filter((e): e is NonCandidateDetail => !isCandidate(e));

  if (candidates.length === 0) {
    const allInsufficientData = nonCandidates.every((e) => e.state === "insufficient-data");
    if (allInsufficientData) {
      return { kind: "insufficient-data", headline: "아직 판단할 데이터가 부족합니다" };
    }
    return { kind: "no-candidate", headline: buildNoCandidateHeadline(nonCandidates), resources: nonCandidates };
  }

  if (candidates.length === 1) {
    const primary = candidates[0];
    return {
      kind: "single-primary",
      headline: `가장 의심되는 병목 후보: ${primary.label}`,
      primary,
      secondaryCandidates: [],
      others: nonCandidates,
    };
  }

  const maxDuration = Math.max(...candidates.map((c) => c.durationSeconds));
  const topGroup = candidates.filter((c) => c.durationSeconds === maxDuration);

  if (topGroup.length === 1) {
    const primary = topGroup[0];
    const secondaryCandidates = candidates.filter((c) => c !== primary);
    return {
      kind: "single-primary",
      headline: `가장 의심되는 병목 후보: ${primary.label}`,
      primary,
      secondaryCandidates,
      others: nonCandidates,
    };
  }

  return {
    kind: "tied-primary",
    headline: `동시에 감지된 병목 후보: ${candidates.map((c) => c.label).join(", ")}`,
    candidates,
    others: nonCandidates,
  };
}
