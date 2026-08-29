import { describe, expect, it } from "vitest";
import { appendSampleIfNew, shouldShowConnectionWarning } from "./live-samples";
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

describe("appendSampleIfNew", () => {
  it("measuredAt A를 받으면 sample이 1개 추가된다", () => {
    const result = appendSampleIfNew([], baseReceived({ measuredAt: "A" }), 20);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      measuredAt: "A",
      cpuPercent: 20.0,
      ramPercent: 40.0,
      diskActivePercent: 1.0,
    });
  });

  it("같은 measuredAt A를 다시 받으면 중복 추가되지 않는다", () => {
    const first = appendSampleIfNew([], baseReceived({ measuredAt: "A" }), 20);
    const second = appendSampleIfNew(first, baseReceived({ measuredAt: "A", cpuPercent: 99.0 }), 20);

    expect(second).toHaveLength(1);
    expect(second).toBe(first); // 참조도 그대로(불필요한 리렌더 방지)
    expect(second[0].cpuPercent).toBe(20.0); // 새 값으로 덮어쓰지도 않는다
  });

  it("measuredAt B(A와 다름)를 받으면 다음 sample이 추가된다", () => {
    const first = appendSampleIfNew([], baseReceived({ measuredAt: "A" }), 20);
    const second = appendSampleIfNew(first, baseReceived({ measuredAt: "B" }), 20);

    expect(second).toHaveLength(2);
    expect(second[1].measuredAt).toBe("B");
  });

  it("21번째 서로 다른 measuredAt을 받으면 가장 오래된 sample이 잘려나가고 최근 20개만 유지된다", () => {
    let samples: ReturnType<typeof appendSampleIfNew> = [];
    for (let i = 1; i <= 21; i++) {
      samples = appendSampleIfNew(samples, baseReceived({ measuredAt: `T${i}` }), 20);
    }

    expect(samples).toHaveLength(20);
    expect(samples[0].measuredAt).toBe("T2"); // T1이 잘려나감
    expect(samples[19].measuredAt).toBe("T21");
  });

  it("RAM/Disk가 null인 구버전 Agent payload도 CPU sample은 정상 추가된다", () => {
    const result = appendSampleIfNew(
      [],
      baseReceived({ measuredAt: "A", ram: null, disk: null }),
      20
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      measuredAt: "A",
      cpuPercent: 20.0,
      ramPercent: null,
      diskActivePercent: null,
    });
  });
});

describe("shouldShowConnectionWarning", () => {
  it("연속 실패 0/1/2회는 경고를 표시하지 않는다", () => {
    expect(shouldShowConnectionWarning(0)).toBe(false);
    expect(shouldShowConnectionWarning(1)).toBe(false);
    expect(shouldShowConnectionWarning(2)).toBe(false);
  });

  it("연속 실패 3회 이상이면 경고를 표시한다", () => {
    expect(shouldShowConnectionWarning(3)).toBe(true);
    expect(shouldShowConnectionWarning(4)).toBe(true);
  });
});
