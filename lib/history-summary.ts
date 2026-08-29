import { evaluateComprehensiveDiagnosis } from "./comprehensive-diagnosis";
import type { PerformanceStatus } from "./performance-status";

type ReceivedStatus = Extract<PerformanceStatus, { status: "received" }>;
type ResourceKey = "cpu" | "ram" | "disk";

export type HistoryEntry = {
  measuredAt: string;
  statusLabel: string;
};

export type HistorySummary =
  | { kind: "empty" }
  | {
      kind: "summary";
      totalCount: number;
      candidateCount: number;
      topResourceLabel: string | null;
      headline: string;
    };

const RESOURCE_ORDER: ResourceKey[] = ["cpu", "ram", "disk"];
const RESOURCE_LABEL: Record<ResourceKey, string> = { cpu: "CPU", ram: "RAM", disk: "Disk" };

function describeEntry(status: ReceivedStatus): HistoryEntry {
  const diagnosis = evaluateComprehensiveDiagnosis(status);
  let statusLabel: string;

  if (diagnosis.kind === "insufficient-data") {
    statusLabel = "데이터 부족";
  } else if (diagnosis.kind === "no-candidate") {
    statusLabel = "정상";
  } else if (diagnosis.kind === "single-primary") {
    statusLabel = `${diagnosis.primary.label} 병목 후보`;
  } else {
    statusLabel = `${diagnosis.candidates.map((c) => c.label).join(", ")} 동시 병목 후보`;
  }

  return { measuredAt: status.measuredAt, statusLabel };
}

export function describeHistoryEntries(statuses: ReceivedStatus[]): HistoryEntry[] {
  return statuses.map(describeEntry);
}

function candidateResourcesOf(status: ReceivedStatus): ResourceKey[] {
  const diagnosis = evaluateComprehensiveDiagnosis(status);
  if (diagnosis.kind === "single-primary") {
    return [diagnosis.primary.resource, ...diagnosis.secondaryCandidates.map((c) => c.resource)];
  }
  if (diagnosis.kind === "tied-primary") {
    return diagnosis.candidates.map((c) => c.resource);
  }
  return [];
}

export function summarizeHistory(statuses: ReceivedStatus[]): HistorySummary {
  if (statuses.length === 0) {
    return { kind: "empty" };
  }

  const totalCount = statuses.length;
  const entries = describeHistoryEntries(statuses);

  const counts: Record<ResourceKey, number> = { cpu: 0, ram: 0, disk: 0 };
  let candidateCount = 0;
  for (const status of statuses) {
    const resources = candidateResourcesOf(status);
    if (resources.length > 0) candidateCount += 1;
    for (const resource of resources) {
      counts[resource] += 1;
    }
  }

  const maxCount = Math.max(...RESOURCE_ORDER.map((r) => counts[r]));
  const topResources = RESOURCE_ORDER.filter((r) => maxCount > 0 && counts[r] === maxCount);
  const topResourceLabel = topResources.length > 0 ? topResources.map((r) => RESOURCE_LABEL[r]).join(", ") : null;

  const headline =
    totalCount === 1
      ? `가장 최근 분석: ${entries[0].statusLabel}`
      : candidateCount === 0
        ? `측정한 범위에서 최근 ${totalCount}번 모두 병목 후보가 발견되지 않았습니다`
        : `최근 ${totalCount}번 중 ${candidateCount}번 ${topResourceLabel} 병목 후보 감지됨`;

  return { kind: "summary", totalCount, candidateCount, topResourceLabel, headline };
}
