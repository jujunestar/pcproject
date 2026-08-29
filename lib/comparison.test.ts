import { describe, expect, it } from "vitest";
import { compareDiagnosis } from "./comparison";
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

describe("compareDiagnosis", () => {
  it("RAM이 병목 후보에서 정상으로 바뀌면 개선으로 판단하고 RAM을 headline으로 잡는다", () => {
    const previous = baseReceived({
      ram: {
        percent: 94.0,
        usedBytes: 1000,
        availableBytes: 100,
        status: "bottleneck-candidate",
        evidence: {
          startedAt: "2026-08-29T05:00:00.000Z",
          endedAt: "2026-08-29T05:00:06.000Z",
          durationSeconds: 6.0,
          maxRamPercent: 94.0,
        },
        topProcess: { pid: 5336, name: "powershell.exe", rss: 7346740429, memoryPercent: 40 },
      },
    });
    const current = baseReceived({ ram: { ...baseReceived().ram!, percent: 67.0 } });

    const result = compareDiagnosis(previous, current);

    expect(result.overallMessage).toBe("개선");
    expect(result.headlineChange?.resource).toBe("ram");
    expect(result.headlineChange?.beforeValueLabel).toBe("94.0%");
    expect(result.headlineChange?.afterValueLabel).toBe("67.0%");
    expect(result.headlineChange?.candidateChange).toBe("detected-to-cleared");

    const ramChange = result.resourceChanges.find((c) => c.resource === "ram");
    expect(ramChange?.direction).toBe("improved");
  });

  it("정상이던 리소스가 새로 병목 후보가 되면 악화로 판단한다", () => {
    const previous = baseReceived();
    const current = baseReceived({
      overloadStatus: "overload-candidate",
      overloadEvidence: {
        startedAt: "2026-08-29T05:00:00.000Z",
        endedAt: "2026-08-29T05:00:08.000Z",
        durationSeconds: 8.0,
        maxCpuPercent: 96.0,
      },
    });

    const result = compareDiagnosis(previous, current);

    expect(result.overallMessage).toBe("악화");
    expect(result.headlineChange?.resource).toBe("cpu");
    expect(result.headlineChange?.candidateChange).toBe("normal-to-candidate");
  });

  it("아무 상태 전환도 없으면 값이 조금 달라도 뚜렷한 변화 없음으로 판단하고, 가장 변화 폭이 큰 리소스를 headline으로 잡는다", () => {
    const previous = baseReceived({ cpuPercent: 20.0, ram: { ...baseReceived().ram!, percent: 40.0 } });
    const current = baseReceived({ cpuPercent: 22.0, ram: { ...baseReceived().ram!, percent: 55.0 } });

    const result = compareDiagnosis(previous, current);

    expect(result.overallMessage).toBe("뚜렷한 변화 없음");
    expect(result.headlineChange?.resource).toBe("ram");
  });

  it("완전히 같은 값이면 unchanged로 판단한다", () => {
    const status = baseReceived();

    const result = compareDiagnosis(status, status);

    expect(result.overallMessage).toBe("뚜렷한 변화 없음");
    for (const change of result.resourceChanges) {
      expect(change.direction).toBe("unchanged");
      expect(change.candidateChange).toBe("unchanged-normal");
    }
  });

  it("RAM이 구버전 Agent라 null이면 해당 리소스는 insufficient-data로 표시하고 unknown 방향을 준다", () => {
    const previous = baseReceived({ ram: null });
    const current = baseReceived({ ram: null });

    const result = compareDiagnosis(previous, current);

    const ramChange = result.resourceChanges.find((c) => c.resource === "ram");
    expect(ramChange?.candidateChange).toBe("insufficient-data");
    expect(ramChange?.direction).toBe("unknown");
    expect(ramChange?.beforeValueLabel).toBe("데이터 없음");
  });

  it("개선과 악화가 동시에 발생하면 혼합 메시지를 준다", () => {
    const previous = baseReceived({
      ram: {
        percent: 94.0,
        usedBytes: 1000,
        availableBytes: 100,
        status: "bottleneck-candidate",
        evidence: {
          startedAt: "2026-08-29T05:00:00.000Z",
          endedAt: "2026-08-29T05:00:06.000Z",
          durationSeconds: 6.0,
          maxRamPercent: 94.0,
        },
        topProcess: null,
      },
    });
    const current = baseReceived({
      ram: { ...baseReceived().ram!, percent: 50.0 },
      overloadStatus: "overload-candidate",
      overloadEvidence: {
        startedAt: "2026-08-29T05:00:00.000Z",
        endedAt: "2026-08-29T05:00:08.000Z",
        durationSeconds: 8.0,
        maxCpuPercent: 96.0,
      },
    });

    const result = compareDiagnosis(previous, current);

    expect(result.overallMessage).toBe("변화 있음 (일부 개선, 일부 악화)");
  });
});
