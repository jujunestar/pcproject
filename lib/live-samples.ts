import type { PerformanceStatus } from "./performance-status";

type ReceivedStatus = Extract<PerformanceStatus, { status: "received" }>;

export type LiveSample = {
  measuredAt: string;
  cpuPercent: number;
  ramPercent: number | null;
  diskActivePercent: number | null;
};

const CONNECTION_WARNING_THRESHOLD = 3;

function toSample(status: ReceivedStatus): LiveSample {
  return {
    measuredAt: status.measuredAt,
    cpuPercent: status.cpuPercent,
    ramPercent: status.ram?.percent ?? null,
    diskActivePercent: status.disk?.activePercent ?? null,
  };
}

// Agent의 판정용 이력(agent/*_agent.py의 trim_history)과는 완전히 다른,
// 브라우저 메모리에만 존재하는 실시간 그래프용 이력이다. 같은 measuredAt이
// 반복 도착하면(Agent가 아직 새 값을 만들지 못한 경우) 중복 추가하지 않는다.
export function appendSampleIfNew(
  existing: LiveSample[],
  status: ReceivedStatus,
  maxSamples: number
): LiveSample[] {
  const last = existing[existing.length - 1];
  if (last !== undefined && last.measuredAt === status.measuredAt) {
    return existing;
  }

  const next = [...existing, toSample(status)];
  if (next.length > maxSamples) {
    return next.slice(next.length - maxSamples);
  }
  return next;
}

// no-data는 실패로 세지 않는다(Agent가 아직 값을 안 올린 정상적인 대기
// 상태일 뿐 연결 문제가 아니기 때문) — 호출하는 쪽에서 이미 걸러내고
// fetch-failed/invalid-format/invalid-code만 카운트해 넘겨준다.
export function shouldShowConnectionWarning(consecutiveFailureCount: number): boolean {
  return consecutiveFailureCount >= CONNECTION_WARNING_THRESHOLD;
}
