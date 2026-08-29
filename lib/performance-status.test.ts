import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPerformanceStatus } from "./performance-status";

function mockFetchOnce(response: { ok: boolean; json: () => Promise<unknown> }) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response as Response));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const baseCpuFields = {
  cpuPercent: 42.3,
  measuredAt: "2026-08-29T05:32:10.000Z",
  overloadStatus: "normal",
  overloadEvidence: null,
  topProcess: null,
};

describe("fetchPerformanceStatus", () => {
  it("올바른 6자리 연결 코드는 /api/data를 조회한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ value: JSON.stringify(baseCpuFields) }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchPerformanceStatus("ABC123");

    expect(fetchMock).toHaveBeenCalledWith("/api/data?code=ABC123");
  });

  it("6자리 영숫자가 아닌 코드는 조회 없이 잘못된 연결 코드 형식으로 거부한다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPerformanceStatus("ABCDE");

    expect(result).toEqual({ status: "invalid-code" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("value가 null이면 아직 수신된 데이터 없음 상태가 된다", async () => {
    mockFetchOnce({ ok: true, json: async () => ({ value: null }) });

    const result = await fetchPerformanceStatus("ABC123");

    expect(result).toEqual({ status: "no-data" });
  });

  it("네트워크 오류가 발생하면 조회 실패 상태가 된다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await fetchPerformanceStatus("ABC123");

    expect(result).toEqual({ status: "fetch-failed" });
  });

  it("API가 오류 응답을 반환하면 조회 실패 상태가 된다", async () => {
    mockFetchOnce({ ok: false, json: async () => ({}) });

    const result = await fetchPerformanceStatus("ABC123");

    expect(result).toEqual({ status: "fetch-failed" });
  });

  it("cpuPercent/measuredAt이 없으면 형식 오류 상태가 된다", async () => {
    mockFetchOnce({ ok: true, json: async () => ({ value: JSON.stringify({ cpuPercent: 1 }) }) });

    const result = await fetchPerformanceStatus("ABC123");

    expect(result).toEqual({ status: "invalid-format" });
  });

  it("RAM/Disk 필드가 아예 없는 구버전 Agent payload는 ram/disk를 null로 두고 CPU는 정상 해석한다", async () => {
    mockFetchOnce({ ok: true, json: async () => ({ value: JSON.stringify(baseCpuFields) }) });

    const result = await fetchPerformanceStatus("ABC123");

    expect(result).toEqual({
      status: "received",
      cpuPercent: 42.3,
      measuredAt: "2026-08-29T05:32:10.000Z",
      overloadStatus: "normal",
      overloadEvidence: null,
      topProcess: null,
      ram: null,
      disk: null,
    });
  });

  it("RAM 정상 상태를 해석한다", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => ({
        value: JSON.stringify({
          ...baseCpuFields,
          ramPercent: 59.8,
          ramUsedBytes: 10140180480,
          ramAvailableBytes: 6808727552,
          ramStatus: "normal",
          ramEvidence: null,
          ramTopProcess: null,
        }),
      }),
    });

    const result = await fetchPerformanceStatus("ABC123");

    expect(result).toMatchObject({
      status: "received",
      ram: {
        percent: 59.8,
        usedBytes: 10140180480,
        availableBytes: 6808727552,
        status: "normal",
        evidence: null,
        topProcess: null,
      },
    });
  });

  it("RAM 병목 후보 상태이면 evidence와 topProcess를 함께 해석한다", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => ({
        value: JSON.stringify({
          ...baseCpuFields,
          ramPercent: 96.0,
          ramUsedBytes: 100,
          ramAvailableBytes: 4,
          ramStatus: "bottleneck-candidate",
          ramEvidence: {
            startedAt: "2026-08-29T05:32:00.000Z",
            endedAt: "2026-08-29T05:32:06.000Z",
            durationSeconds: 6.0,
            maxRamPercent: 96.0,
          },
          ramTopProcess: { pid: 111, name: "chrome.exe", rss: 500000000, memoryPercent: 3.1 },
        }),
      }),
    });

    const result = await fetchPerformanceStatus("ABC123");

    expect(result).toMatchObject({
      status: "received",
      ram: {
        status: "bottleneck-candidate",
        evidence: {
          startedAt: "2026-08-29T05:32:00.000Z",
          endedAt: "2026-08-29T05:32:06.000Z",
          durationSeconds: 6.0,
          maxRamPercent: 96.0,
        },
        topProcess: { pid: 111, name: "chrome.exe", rss: 500000000, memoryPercent: 3.1 },
      },
    });
  });

  it("ramStatus 값이 정의된 3가지 상태가 아니면 형식 오류 상태가 된다", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => ({
        value: JSON.stringify({
          ...baseCpuFields,
          ramPercent: 50,
          ramUsedBytes: 1,
          ramAvailableBytes: 1,
          ramStatus: "매우 나쁨",
          ramEvidence: null,
          ramTopProcess: null,
        }),
      }),
    });

    const result = await fetchPerformanceStatus("ABC123");

    expect(result).toEqual({ status: "invalid-format" });
  });

  it("Disk 용량과 I/O 정상 상태를 해석한다", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => ({
        value: JSON.stringify({
          ...baseCpuFields,
          diskCapacity: { totalBytes: 511046217728, usedBytes: 271363379200, freeBytes: 239682838528, percent: 53.1 },
          diskActivePercent: 5.0,
          diskIoStatus: "normal",
          diskIoEvidence: null,
          diskTopIoProcess: null,
        }),
      }),
    });

    const result = await fetchPerformanceStatus("ABC123");

    expect(result).toMatchObject({
      status: "received",
      disk: {
        capacity: { totalBytes: 511046217728, usedBytes: 271363379200, freeBytes: 239682838528, percent: 53.1 },
        activePercent: 5.0,
        ioStatus: "normal",
        ioEvidence: null,
        topIoProcess: null,
      },
    });
  });

  it("Disk I/O 병목 후보 상태이면 evidence와 topIoProcess를 함께 해석하고 100%를 넘는 값도 그대로 전달한다", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => ({
        value: JSON.stringify({
          ...baseCpuFields,
          diskCapacity: { totalBytes: 100, usedBytes: 90, freeBytes: 10, percent: 90.0 },
          diskActivePercent: 175.0,
          diskIoStatus: "bottleneck-candidate",
          diskIoEvidence: {
            startedAt: "2026-08-29T05:32:00.000Z",
            endedAt: "2026-08-29T05:32:06.000Z",
            durationSeconds: 6.0,
            maxDiskActivePercent: 175.0,
          },
          diskTopIoProcess: { pid: 222, name: "python.exe", bytesPerSec: 5000.0 },
        }),
      }),
    });

    const result = await fetchPerformanceStatus("ABC123");

    expect(result).toMatchObject({
      status: "received",
      disk: {
        activePercent: 175.0,
        ioStatus: "bottleneck-candidate",
        ioEvidence: { maxDiskActivePercent: 175.0 },
        topIoProcess: { pid: 222, name: "python.exe", bytesPerSec: 5000.0 },
      },
    });
  });

  it("Disk 용량 정보가 없어도(diskCapacity: null) I/O 판정은 독립적으로 해석된다", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => ({
        value: JSON.stringify({
          ...baseCpuFields,
          diskCapacity: null,
          diskActivePercent: 5.0,
          diskIoStatus: "normal",
          diskIoEvidence: null,
          diskTopIoProcess: null,
        }),
      }),
    });

    const result = await fetchPerformanceStatus("ABC123");

    expect(result).toMatchObject({
      status: "received",
      disk: { capacity: null, activePercent: 5.0, ioStatus: "normal" },
    });
  });

  it("diskCapacity 필드가 누락된 필드를 가지면 형식 오류 상태가 된다", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => ({
        value: JSON.stringify({
          ...baseCpuFields,
          diskCapacity: { totalBytes: 100, usedBytes: 90 },
          diskActivePercent: 5.0,
          diskIoStatus: "normal",
          diskIoEvidence: null,
          diskTopIoProcess: null,
        }),
      }),
    });

    const result = await fetchPerformanceStatus("ABC123");

    expect(result).toEqual({ status: "invalid-format" });
  });

  it("diskIoStatus 값이 정의된 3가지 상태가 아니면 형식 오류 상태가 된다", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => ({
        value: JSON.stringify({
          ...baseCpuFields,
          diskCapacity: null,
          diskActivePercent: null,
          diskIoStatus: "이상함",
          diskIoEvidence: null,
          diskTopIoProcess: null,
        }),
      }),
    });

    const result = await fetchPerformanceStatus("ABC123");

    expect(result).toEqual({ status: "invalid-format" });
  });
});
