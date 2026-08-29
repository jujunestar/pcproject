import type { PerformanceStatus } from "./performance-status";

type ReceivedStatus = Extract<PerformanceStatus, { status: "received" }>;

export type ResourceKey = "cpu" | "ram" | "disk";

export type CandidateChangeKind =
  | "detected-to-cleared"
  | "normal-to-candidate"
  | "unchanged-candidate"
  | "unchanged-normal"
  | "insufficient-data";

export type ResourceChange = {
  resource: ResourceKey;
  label: string;
  beforeValue: number | null;
  afterValue: number | null;
  beforeValueLabel: string;
  afterValueLabel: string;
  direction: "improved" | "worsened" | "unchanged" | "unknown";
  candidateChange: CandidateChangeKind;
};

export type ComparisonResult = {
  overallMessage: string;
  headlineChange: ResourceChange | null;
  resourceChanges: ResourceChange[];
};

const RESOURCE_LABEL: Record<ResourceKey, string> = { cpu: "CPU", ram: "RAM", disk: "Disk" };
const RESOURCE_ORDER: ResourceKey[] = ["cpu", "ram", "disk"];

function extractValue(status: ReceivedStatus, resource: ResourceKey): number | null {
  if (resource === "cpu") return status.cpuPercent;
  if (resource === "ram") return status.ram?.percent ?? null;
  return status.disk?.activePercent ?? null;
}

function isCandidate(status: ReceivedStatus, resource: ResourceKey): boolean | null {
  if (resource === "cpu") {
    if (status.overloadStatus === "insufficient-data") return null;
    return status.overloadStatus === "overload-candidate";
  }
  if (resource === "ram") {
    if (status.ram === null || status.ram.status === "insufficient-data") return null;
    return status.ram.status === "bottleneck-candidate";
  }
  if (status.disk === null || status.disk.ioStatus === "insufficient-data") return null;
  return status.disk.ioStatus === "bottleneck-candidate";
}

function formatValueLabel(value: number | null): string {
  return value === null ? "데이터 없음" : `${value.toFixed(1)}%`;
}

function buildCandidateChange(
  beforeCandidate: boolean | null,
  afterCandidate: boolean | null
): CandidateChangeKind {
  if (beforeCandidate === null || afterCandidate === null) return "insufficient-data";
  if (beforeCandidate && !afterCandidate) return "detected-to-cleared";
  if (!beforeCandidate && afterCandidate) return "normal-to-candidate";
  if (beforeCandidate && afterCandidate) return "unchanged-candidate";
  return "unchanged-normal";
}

function buildResourceChange(
  before: ReceivedStatus,
  after: ReceivedStatus,
  resource: ResourceKey
): ResourceChange {
  const beforeValue = extractValue(before, resource);
  const afterValue = extractValue(after, resource);

  let direction: ResourceChange["direction"];
  if (beforeValue === null || afterValue === null) {
    direction = "unknown";
  } else if (afterValue < beforeValue) {
    direction = "improved";
  } else if (afterValue > beforeValue) {
    direction = "worsened";
  } else {
    direction = "unchanged";
  }

  return {
    resource,
    label: RESOURCE_LABEL[resource],
    beforeValue,
    afterValue,
    beforeValueLabel: formatValueLabel(beforeValue),
    afterValueLabel: formatValueLabel(afterValue),
    direction,
    candidateChange: buildCandidateChange(isCandidate(before, resource), isCandidate(after, resource)),
  };
}

function pickHeadlineChange(changes: ResourceChange[]): ResourceChange | null {
  const transitions = changes.filter(
    (c) => c.candidateChange === "detected-to-cleared" || c.candidateChange === "normal-to-candidate"
  );
  if (transitions.length > 0) {
    return transitions[0];
  }

  let best: ResourceChange | null = null;
  let bestDelta = -1;
  for (const change of changes) {
    if (change.beforeValue === null || change.afterValue === null) continue;
    const delta = Math.abs(change.afterValue - change.beforeValue);
    if (delta > bestDelta) {
      bestDelta = delta;
      best = change;
    }
  }
  return best;
}

function buildOverallMessage(changes: ResourceChange[]): string {
  const cleared = changes.filter((c) => c.candidateChange === "detected-to-cleared");
  const newlyDetected = changes.filter((c) => c.candidateChange === "normal-to-candidate");

  if (cleared.length > 0 && newlyDetected.length === 0) return "개선";
  if (newlyDetected.length > 0 && cleared.length === 0) return "악화";
  if (cleared.length > 0 && newlyDetected.length > 0) return "변화 있음 (일부 개선, 일부 악화)";
  return "뚜렷한 변화 없음";
}

export function compareDiagnosis(previous: ReceivedStatus, current: ReceivedStatus): ComparisonResult {
  const resourceChanges = RESOURCE_ORDER.map((resource) => buildResourceChange(previous, current, resource));
  return {
    overallMessage: buildOverallMessage(resourceChanges),
    headlineChange: pickHeadlineChange(resourceChanges),
    resourceChanges,
  };
}

// Redis에 아직 남아있는 이전 값을 그대로 "다시 분석" 결과로 오인하지
// 않기 위한 판정이다. measuredAt이 실제로 달라진, 진짜 새 측정값일
// 때만 true를 반환한다.
export function hasNewMeasurement(
  previous: ReceivedStatus,
  candidate: PerformanceStatus
): candidate is ReceivedStatus {
  return candidate.status === "received" && candidate.measuredAt !== previous.measuredAt;
}
