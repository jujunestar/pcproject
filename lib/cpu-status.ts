export type OverloadStatus = "insufficient-data" | "normal" | "overload-candidate";

export type OverloadEvidence = {
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  maxCpuPercent: number;
};

export type TopProcess = {
  pid: number;
  name: string;
  cpuPercent: number;
};

export type CpuStatus =
  | { status: "invalid-code" }
  | { status: "no-data" }
  | {
      status: "received";
      cpuPercent: number;
      measuredAt: string;
      overloadStatus: OverloadStatus;
      overloadEvidence: OverloadEvidence | null;
      topProcess: TopProcess | null;
    }
  | { status: "fetch-failed" }
  | { status: "invalid-format" };

const CODE_PATTERN = /^[A-Za-z0-9]{6}$/;
const OVERLOAD_STATUSES: readonly OverloadStatus[] = [
  "insufficient-data",
  "normal",
  "overload-candidate",
];

function parseOverloadEvidence(value: unknown): OverloadEvidence | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== "object") {
    return undefined;
  }
  const { startedAt, endedAt, durationSeconds, maxCpuPercent } = value as Record<
    string,
    unknown
  >;
  if (
    typeof startedAt !== "string" ||
    typeof endedAt !== "string" ||
    typeof durationSeconds !== "number" ||
    typeof maxCpuPercent !== "number"
  ) {
    return undefined;
  }
  return { startedAt, endedAt, durationSeconds, maxCpuPercent };
}

function parseTopProcess(value: unknown): TopProcess | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== "object") {
    return undefined;
  }
  const { pid, name, cpuPercent } = value as Record<string, unknown>;
  if (typeof pid !== "number" || typeof name !== "string" || typeof cpuPercent !== "number") {
    return undefined;
  }
  return { pid, name, cpuPercent };
}

function parseValue(value: string): CpuStatus {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { status: "invalid-format" };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { status: "invalid-format" };
  }

  const { cpuPercent, measuredAt, overloadStatus, overloadEvidence, topProcess } =
    parsed as Record<string, unknown>;

  if (typeof cpuPercent !== "number" || typeof measuredAt !== "string") {
    return { status: "invalid-format" };
  }

  if (
    typeof overloadStatus !== "string" ||
    !OVERLOAD_STATUSES.includes(overloadStatus as OverloadStatus)
  ) {
    return { status: "invalid-format" };
  }

  const parsedEvidence = parseOverloadEvidence(overloadEvidence);
  if (parsedEvidence === undefined) {
    return { status: "invalid-format" };
  }

  const parsedTopProcess = parseTopProcess(topProcess);
  if (parsedTopProcess === undefined) {
    return { status: "invalid-format" };
  }

  return {
    status: "received",
    cpuPercent,
    measuredAt,
    overloadStatus: overloadStatus as OverloadStatus,
    overloadEvidence: parsedEvidence,
    topProcess: parsedTopProcess,
  };
}

export async function fetchCpuStatus(code: string): Promise<CpuStatus> {
  if (!CODE_PATTERN.test(code)) {
    return { status: "invalid-code" };
  }

  let response: Response;
  try {
    response = await fetch(`/api/data?code=${encodeURIComponent(code)}`);
  } catch {
    return { status: "fetch-failed" };
  }

  if (!response.ok) {
    return { status: "fetch-failed" };
  }

  const body = (await response.json()) as { value: string | null };
  if (body.value === null) {
    return { status: "no-data" };
  }

  return parseValue(body.value);
}
