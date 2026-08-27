export type CpuStatus =
  | { status: "invalid-code" }
  | { status: "no-data" }
  | { status: "received"; cpuPercent: number; measuredAt: string }
  | { status: "fetch-failed" }
  | { status: "invalid-format" };

const CODE_PATTERN = /^[A-Za-z0-9]{6}$/;

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

  const { cpuPercent, measuredAt } = parsed as Record<string, unknown>;
  if (typeof cpuPercent !== "number" || typeof measuredAt !== "string") {
    return { status: "invalid-format" };
  }

  return { status: "received", cpuPercent, measuredAt };
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
