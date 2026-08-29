import { describe, expect, it } from "vitest";
import { describeHistoryEntries, summarizeHistory } from "./history-summary";
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

function ramCandidate(measuredAt: string): Received["ram"] {
  return {
    percent: 94.0,
    usedBytes: 1000,
    availableBytes: 100,
    status: "bottleneck-candidate",
    evidence: {
      startedAt: measuredAt,
      endedAt: measuredAt,
      durationSeconds: 6.0,
      maxRamPercent: 94.0,
    },
    topProcess: { pid: 5336, name: "powershell.exe", rss: 7346740429, memoryPercent: 40 },
  };
}

function diskCandidate(measuredAt: string): Received["disk"] {
  return {
    capacity: { totalBytes: 100, usedBytes: 50, freeBytes: 50, percent: 50.0 },
    activePercent: 132.5,
    ioStatus: "bottleneck-candidate",
    ioEvidence: {
      startedAt: measuredAt,
      endedAt: measuredAt,
      durationSeconds: 6.0,
      maxDiskActivePercent: 132.5,
    },
    topIoProcess: { pid: 8821, name: "chrome.exe", bytesPerSec: 524698.9 },
  };
}

describe("summarizeHistory", () => {
  it("빈 배열이면 empty를 반환한다", () => {
    expect(summarizeHistory([])).toEqual({ kind: "empty" });
  });

  it("기록이 1개면 '가장 최근 분석' 형태의 headline을 만든다", () => {
    const status = baseReceived({ ram: ramCandidate("2026-08-29T05:00:00.000Z") });

    const result = summarizeHistory([status]);

    expect(result).toMatchObject({
      kind: "summary",
      totalCount: 1,
      candidateCount: 1,
      topResourceLabel: "RAM",
      headline: "가장 최근 분석: RAM 병목 후보",
    });
  });

  it("5개 중 3개가 RAM 병목 후보면 정확한 문장을 만든다", () => {
    const statuses = [
      baseReceived({ ram: ramCandidate("t1") }),
      baseReceived(),
      baseReceived({ ram: ramCandidate("t3") }),
      baseReceived(),
      baseReceived({ ram: ramCandidate("t5") }),
    ];

    const result = summarizeHistory(statuses);

    expect(result).toMatchObject({
      kind: "summary",
      totalCount: 5,
      candidateCount: 3,
      topResourceLabel: "RAM",
      headline: "최근 5번 중 3번 RAM 병목 후보 감지됨",
    });
  });

  it("후보가 0건이면 모두 정상 문구를 만든다", () => {
    const statuses = [baseReceived(), baseReceived(), baseReceived()];

    const result = summarizeHistory(statuses);

    expect(result).toMatchObject({
      kind: "summary",
      candidateCount: 0,
      topResourceLabel: null,
      headline: "측정한 범위에서 최근 3번 모두 병목 후보가 발견되지 않았습니다",
    });
  });

  it("RAM과 Disk가 동률로 가장 자주 등장하면 둘 다 표시한다", () => {
    const statuses = [
      baseReceived({ ram: ramCandidate("t1") }),
      baseReceived({ disk: diskCandidate("t2") }),
    ];

    const result = summarizeHistory(statuses);

    expect(result).toMatchObject({ topResourceLabel: "RAM, Disk" });
  });
});

describe("describeHistoryEntries", () => {
  it("정상/단일 후보/동시 후보/데이터 부족 네 가지 라벨을 각각 만든다", () => {
    const normal = baseReceived({ measuredAt: "t-normal" });
    const singleCandidate = baseReceived({ measuredAt: "t-single", ram: ramCandidate("t-single") });
    const tiedCandidate = baseReceived({
      measuredAt: "t-tied",
      ram: ramCandidate("t-tied"),
      disk: diskCandidate("t-tied"),
    });
    const insufficient = baseReceived({
      measuredAt: "t-insufficient",
      overloadStatus: "insufficient-data",
      ram: null,
      disk: null,
    });

    const result = describeHistoryEntries([normal, singleCandidate, tiedCandidate, insufficient]);

    expect(result).toEqual([
      { measuredAt: "t-normal", statusLabel: "정상" },
      { measuredAt: "t-single", statusLabel: "RAM 병목 후보" },
      { measuredAt: "t-tied", statusLabel: "RAM, Disk 동시 병목 후보" },
      { measuredAt: "t-insufficient", statusLabel: "데이터 부족" },
    ]);
  });
});
