import { describe, expect, it } from "vitest";
import { evaluateComprehensiveDiagnosis } from "./comprehensive-diagnosis";
import type { PerformanceStatus } from "./performance-status";

type Received = Extract<PerformanceStatus, { status: "received" }>;

function baseReceived(overrides: Partial<Received> = {}): Received {
  return {
    status: "received",
    cpuPercent: 20.0,
    measuredAt: "2026-08-29T05:00:00.000Z",
    overloadStatus: "normal",
    overloadEvidence: null,
    topProcess: null,
    ram: {
      percent: 40.0,
      usedBytes: 1000,
      availableBytes: 2000,
      status: "normal",
      evidence: null,
      topProcess: null,
    },
    disk: {
      capacity: { totalBytes: 100, usedBytes: 50, freeBytes: 50, percent: 50.0 },
      activePercent: 1.0,
      ioStatus: "normal",
      ioEvidence: null,
      topIoProcess: null,
    },
    ...overrides,
  };
}

function cpuCandidate(durationSeconds: number, startedAt = "2026-08-29T05:00:00.000Z") {
  return {
    overloadStatus: "overload-candidate" as const,
    overloadEvidence: {
      startedAt,
      endedAt: "2026-08-29T05:00:00.000Z",
      durationSeconds,
      maxCpuPercent: 96.2,
    },
    topProcess: { pid: 111, name: "cpu-hog.exe", cpuPercent: 95.0 },
  };
}

function ramCandidate(durationSeconds: number, startedAt = "2026-08-29T05:00:00.000Z") {
  return {
    percent: 94.0,
    usedBytes: 1000,
    availableBytes: 100,
    status: "bottleneck-candidate" as const,
    evidence: {
      startedAt,
      endedAt: "2026-08-29T05:00:00.000Z",
      durationSeconds,
      maxRamPercent: 94.0,
    },
    topProcess: { pid: 5336, name: "powershell.exe", rss: 7346740429, memoryPercent: 40 },
  };
}

function diskCandidate(durationSeconds: number, startedAt = "2026-08-29T05:00:00.000Z") {
  return {
    capacity: { totalBytes: 100, usedBytes: 50, freeBytes: 50, percent: 50.0 },
    activePercent: 132.5,
    ioStatus: "bottleneck-candidate" as const,
    ioEvidence: {
      startedAt,
      endedAt: "2026-08-29T05:00:00.000Z",
      durationSeconds,
      maxDiskActivePercent: 132.5,
    },
    topIoProcess: { pid: 8821, name: "chrome.exe", bytesPerSec: 524698.9 },
  };
}

describe("evaluateComprehensiveDiagnosis", () => {
  it("모두 정상이면 병목 후보 없음으로 표시하고 과장하지 않는다", () => {
    const result = evaluateComprehensiveDiagnosis(baseReceived());

    expect(result.kind).toBe("no-candidate");
    expect(result).toMatchObject({
      headline: "측정한 CPU/RAM/Disk 범위에서 병목 후보가 발견되지 않았습니다",
    });
  });

  it("셋 다 데이터 부족(ram/disk는 null)이면 후보를 언급하지 않는다", () => {
    const result = evaluateComprehensiveDiagnosis(
      baseReceived({ overloadStatus: "insufficient-data", ram: null, disk: null })
    );

    expect(result).toEqual({
      kind: "insufficient-data",
      headline: "아직 판단할 데이터가 부족합니다",
    });
  });

  it("후보가 0개이고 normal/insufficient-data가 섞이면 모두 정상이라고 말하지 않는다", () => {
    const result = evaluateComprehensiveDiagnosis(
      baseReceived({ overloadStatus: "insufficient-data" })
    );

    expect(result.kind).toBe("no-candidate");
    expect(result).toMatchObject({
      headline: "RAM, Disk 정상 확인, CPU 데이터 부족",
    });
  });

  it("후보가 1개면 그 리소스를 가장 의심되는 병목 후보로 표시한다", () => {
    const result = evaluateComprehensiveDiagnosis(baseReceived(cpuCandidate(8.0)));

    expect(result.kind).toBe("single-primary");
    if (result.kind !== "single-primary") throw new Error("unreachable");
    expect(result.headline).toBe("가장 의심되는 병목 후보: CPU");
    expect(result.primary.resource).toBe("cpu");
    expect(result.primary.durationSeconds).toBe(8.0);
    expect(result.primary.topProcessSummary).toBe("cpu-hog.exe (PID 111, CPU 95.0%)");
    expect(result.secondaryCandidates).toEqual([]);
    expect(result.others.map((o) => o.resource)).toEqual(["ram", "disk"]);
  });

  it("후보가 2개 이상이고 지속시간이 서로 다르면 가장 긴 후보가 대표가 된다 (RAM 6.0초 < Disk 7.0초 → Disk가 대표)", () => {
    const result = evaluateComprehensiveDiagnosis(
      baseReceived({ ram: ramCandidate(6.0), disk: diskCandidate(7.0) })
    );

    expect(result.kind).toBe("single-primary");
    if (result.kind !== "single-primary") throw new Error("unreachable");
    expect(result.headline).toBe("가장 의심되는 병목 후보: Disk");
    expect(result.primary.resource).toBe("disk");
    expect(result.secondaryCandidates.map((c) => c.resource)).toEqual(["ram"]);
  });

  it("최댓값 지속시간이 완전히 동률이면 임의의 승자를 만들지 않고 모두 동시 후보로 표시한다", () => {
    const result = evaluateComprehensiveDiagnosis(
      baseReceived({ ram: ramCandidate(6.0), disk: diskCandidate(6.0) })
    );

    expect(result.kind).toBe("tied-primary");
    if (result.kind !== "tied-primary") throw new Error("unreachable");
    expect(result.headline).toBe("동시에 감지된 병목 후보: RAM, Disk");
    expect(result.candidates.map((c) => c.resource)).toEqual(["ram", "disk"]);
  });

  it("3개 후보 중 하나만 최댓값이면, 나머지 둘은 서로 지속시간이 달라도 모두 동시 후보로 표시한다", () => {
    const result = evaluateComprehensiveDiagnosis(
      baseReceived({
        ...cpuCandidate(8.0),
        ram: ramCandidate(6.0),
        disk: diskCandidate(5.0),
      })
    );

    expect(result.kind).toBe("single-primary");
    if (result.kind !== "single-primary") throw new Error("unreachable");
    expect(result.primary.resource).toBe("cpu");
    expect(result.secondaryCandidates.map((c) => c.resource)).toEqual(["ram", "disk"]);
    expect(result.others).toEqual([]);
  });

  it("후보와 데이터 부족 리소스가 함께 있으면 데이터 부족을 숨기지 않는다", () => {
    const result = evaluateComprehensiveDiagnosis(
      baseReceived({ ...cpuCandidate(8.0), disk: null })
    );

    expect(result.kind).toBe("single-primary");
    if (result.kind !== "single-primary") throw new Error("unreachable");
    const disk = result.others.find((o) => o.resource === "disk");
    expect(disk).toMatchObject({ state: "insufficient-data", shortSummary: "데이터 부족" });
  });

  it("관련 프로세스 후보가 없으면(null) topProcessSummary도 null이다", () => {
    const result = evaluateComprehensiveDiagnosis(
      baseReceived({
        overloadStatus: "overload-candidate",
        overloadEvidence: {
          startedAt: "2026-08-29T05:00:00.000Z",
          endedAt: "2026-08-29T05:00:06.000Z",
          durationSeconds: 6.0,
          maxCpuPercent: 96.2,
        },
        topProcess: null,
      })
    );

    expect(result.kind).toBe("single-primary");
    if (result.kind !== "single-primary") throw new Error("unreachable");
    expect(result.primary.topProcessSummary).toBeNull();
  });

  it("정상 상태의 RAM은 shortSummary에 사용률을 함께 표시한다", () => {
    const result = evaluateComprehensiveDiagnosis(baseReceived(cpuCandidate(8.0)));

    expect(result.kind).toBe("single-primary");
    if (result.kind !== "single-primary") throw new Error("unreachable");
    const ram = result.others.find((o) => o.resource === "ram");
    expect(ram).toMatchObject({ state: "normal", shortSummary: "정상 (40.0%)" });
  });
});
