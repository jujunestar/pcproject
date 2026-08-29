import type { OverloadEvidence, OverloadStatus, TopProcess } from "./cpu-status";

export type { OverloadEvidence, OverloadStatus, TopProcess };

export type RamStatus = "insufficient-data" | "normal" | "bottleneck-candidate";

export type RamEvidence = {
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  maxRamPercent: number;
};

export type RamTopProcess = {
  pid: number;
  name: string;
  rss: number;
  memoryPercent: number;
};

export type RamInfo = {
  percent: number | null;
  usedBytes: number | null;
  availableBytes: number | null;
  status: RamStatus;
  evidence: RamEvidence | null;
  topProcess: RamTopProcess | null;
};

export type DiskCapacity = {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  percent: number;
};

export type DiskIoStatus = "insufficient-data" | "normal" | "bottleneck-candidate";

export type DiskIoEvidence = {
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  maxDiskActivePercent: number;
};

export type DiskTopIoProcess = {
  pid: number;
  name: string;
  bytesPerSec: number;
};

export type DiskInfo = {
  capacity: DiskCapacity | null;
  activePercent: number | null;
  ioStatus: DiskIoStatus;
  ioEvidence: DiskIoEvidence | null;
  topIoProcess: DiskTopIoProcess | null;
};

export type PerformanceStatus =
  | { status: "invalid-code" }
  | { status: "no-data" }
  | {
      status: "received";
      cpuPercent: number;
      measuredAt: string;
      overloadStatus: OverloadStatus;
      overloadEvidence: OverloadEvidence | null;
      topProcess: TopProcess | null;
      ram: RamInfo | null;
      disk: DiskInfo | null;
    }
  | { status: "fetch-failed" }
  | { status: "invalid-format" };

const CODE_PATTERN = /^[A-Za-z0-9]{6}$/;
const OVERLOAD_STATUSES: readonly OverloadStatus[] = [
  "insufficient-data",
  "normal",
  "overload-candidate",
];
const RAM_STATUSES: readonly RamStatus[] = [
  "insufficient-data",
  "normal",
  "bottleneck-candidate",
];
const DISK_IO_STATUSES: readonly DiskIoStatus[] = [
  "insufficient-data",
  "normal",
  "bottleneck-candidate",
];

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

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

function parseRamEvidence(value: unknown): RamEvidence | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== "object") {
    return undefined;
  }
  const { startedAt, endedAt, durationSeconds, maxRamPercent } = value as Record<
    string,
    unknown
  >;
  if (
    typeof startedAt !== "string" ||
    typeof endedAt !== "string" ||
    typeof durationSeconds !== "number" ||
    typeof maxRamPercent !== "number"
  ) {
    return undefined;
  }
  return { startedAt, endedAt, durationSeconds, maxRamPercent };
}

function parseRamTopProcess(value: unknown): RamTopProcess | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== "object") {
    return undefined;
  }
  const { pid, name, rss, memoryPercent } = value as Record<string, unknown>;
  if (
    typeof pid !== "number" ||
    typeof name !== "string" ||
    typeof rss !== "number" ||
    typeof memoryPercent !== "number"
  ) {
    return undefined;
  }
  return { pid, name, rss, memoryPercent };
}

function parseRam(parsed: Record<string, unknown>): RamInfo | null | undefined {
  if (!("ramStatus" in parsed)) {
    // 구버전 Agent(RAM/Disk 미지원)와의 하위 호환: 필드 자체가 없으면
    // "측정하지 않음"으로 취급하고 임의의 값을 만들지 않는다.
    return null;
  }

  const { ramPercent, ramUsedBytes, ramAvailableBytes, ramStatus, ramEvidence, ramTopProcess } =
    parsed;

  if (!isNullableNumber(ramPercent) || !isNullableNumber(ramUsedBytes) || !isNullableNumber(ramAvailableBytes)) {
    return undefined;
  }
  if (typeof ramStatus !== "string" || !RAM_STATUSES.includes(ramStatus as RamStatus)) {
    return undefined;
  }
  const evidence = parseRamEvidence(ramEvidence);
  if (evidence === undefined) {
    return undefined;
  }
  const topProcess = parseRamTopProcess(ramTopProcess);
  if (topProcess === undefined) {
    return undefined;
  }

  return {
    percent: ramPercent,
    usedBytes: ramUsedBytes,
    availableBytes: ramAvailableBytes,
    status: ramStatus as RamStatus,
    evidence,
    topProcess,
  };
}

function parseDiskCapacity(value: unknown): DiskCapacity | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== "object") {
    return undefined;
  }
  const { totalBytes, usedBytes, freeBytes, percent } = value as Record<string, unknown>;
  if (
    typeof totalBytes !== "number" ||
    typeof usedBytes !== "number" ||
    typeof freeBytes !== "number" ||
    typeof percent !== "number"
  ) {
    return undefined;
  }
  return { totalBytes, usedBytes, freeBytes, percent };
}

function parseDiskIoEvidence(value: unknown): DiskIoEvidence | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== "object") {
    return undefined;
  }
  const { startedAt, endedAt, durationSeconds, maxDiskActivePercent } = value as Record<
    string,
    unknown
  >;
  if (
    typeof startedAt !== "string" ||
    typeof endedAt !== "string" ||
    typeof durationSeconds !== "number" ||
    typeof maxDiskActivePercent !== "number"
  ) {
    return undefined;
  }
  return { startedAt, endedAt, durationSeconds, maxDiskActivePercent };
}

function parseDiskTopIoProcess(value: unknown): DiskTopIoProcess | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== "object") {
    return undefined;
  }
  const { pid, name, bytesPerSec } = value as Record<string, unknown>;
  if (typeof pid !== "number" || typeof name !== "string" || typeof bytesPerSec !== "number") {
    return undefined;
  }
  return { pid, name, bytesPerSec };
}

function parseDisk(parsed: Record<string, unknown>): DiskInfo | null | undefined {
  if (!("diskIoStatus" in parsed)) {
    // 구버전 Agent와의 하위 호환: 필드 자체가 없으면 "측정하지 않음".
    return null;
  }

  const { diskCapacity, diskActivePercent, diskIoStatus, diskIoEvidence, diskTopIoProcess } =
    parsed;

  const capacity = parseDiskCapacity(diskCapacity);
  if (capacity === undefined) {
    return undefined;
  }
  if (!isNullableNumber(diskActivePercent)) {
    return undefined;
  }
  if (typeof diskIoStatus !== "string" || !DISK_IO_STATUSES.includes(diskIoStatus as DiskIoStatus)) {
    return undefined;
  }
  const ioEvidence = parseDiskIoEvidence(diskIoEvidence);
  if (ioEvidence === undefined) {
    return undefined;
  }
  const topIoProcess = parseDiskTopIoProcess(diskTopIoProcess);
  if (topIoProcess === undefined) {
    return undefined;
  }

  return {
    capacity,
    activePercent: diskActivePercent,
    ioStatus: diskIoStatus as DiskIoStatus,
    ioEvidence,
    topIoProcess,
  };
}

export function parseValue(value: string): PerformanceStatus {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { status: "invalid-format" };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { status: "invalid-format" };
  }

  const record = parsed as Record<string, unknown>;
  const { cpuPercent, measuredAt, overloadStatus, overloadEvidence, topProcess } = record;

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

  const ram = parseRam(record);
  if (ram === undefined) {
    return { status: "invalid-format" };
  }

  const disk = parseDisk(record);
  if (disk === undefined) {
    return { status: "invalid-format" };
  }

  return {
    status: "received",
    cpuPercent,
    measuredAt,
    overloadStatus: overloadStatus as OverloadStatus,
    overloadEvidence: parsedEvidence,
    topProcess: parsedTopProcess,
    ram,
    disk,
  };
}

export async function fetchPerformanceStatus(code: string): Promise<PerformanceStatus> {
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

export async function fetchHistoryEntries(code: string): Promise<
  | { status: "invalid-code" }
  | { status: "fetch-failed" }
  | { status: "ok"; entries: Array<Extract<PerformanceStatus, { status: "received" }>> }
> {
  if (!CODE_PATTERN.test(code)) {
    return { status: "invalid-code" };
  }

  let response: Response;
  try {
    response = await fetch(`/api/history?code=${encodeURIComponent(code)}`);
  } catch {
    return { status: "fetch-failed" };
  }

  if (!response.ok) {
    return { status: "fetch-failed" };
  }

  const body = (await response.json()) as { entries: string[] };
  const entries = body.entries
    .map((raw) => parseValue(raw))
    .filter(
      (parsed): parsed is Extract<PerformanceStatus, { status: "received" }> =>
        parsed.status === "received"
    );

  return { status: "ok", entries };
}
