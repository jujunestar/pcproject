import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCpuStatus } from "./cpu-status";

function mockFetchOnce(response: { ok: boolean; json: () => Promise<unknown> }) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response as Response));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchCpuStatus", () => {
  it("올바른 6자리 연결 코드는 /api/data를 조회한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        value: JSON.stringify({
          cpuPercent: 42.3,
          measuredAt: "2026-08-27T05:32:10.000Z",
        }),
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchCpuStatus("ABC123");

    expect(fetchMock).toHaveBeenCalledWith("/api/data?code=ABC123");
  });

  it("CPU 데이터가 있으면 cpuPercent와 measuredAt을 정상적으로 해석한다", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => ({
        value: JSON.stringify({
          cpuPercent: 42.3,
          measuredAt: "2026-08-27T05:32:10.000Z",
        }),
      }),
    });

    const result = await fetchCpuStatus("ABC123");

    expect(result).toEqual({
      status: "received",
      cpuPercent: 42.3,
      measuredAt: "2026-08-27T05:32:10.000Z",
    });
  });

  it("value가 null이면 아직 수신된 데이터 없음 상태가 된다", async () => {
    mockFetchOnce({ ok: true, json: async () => ({ value: null }) });

    const result = await fetchCpuStatus("ABC123");

    expect(result).toEqual({ status: "no-data" });
  });

  it("6자리 영숫자가 아닌 코드는 조회 없이 잘못된 연결 코드 형식으로 거부한다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCpuStatus("ABCDE");

    expect(result).toEqual({ status: "invalid-code" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("네트워크 오류가 발생하면 조회 실패 상태가 된다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await fetchCpuStatus("ABC123");

    expect(result).toEqual({ status: "fetch-failed" });
  });

  it("API가 오류 응답(HTTP 4xx/5xx)을 반환하면 조회 실패 상태가 된다", async () => {
    mockFetchOnce({ ok: false, json: async () => ({}) });

    const result = await fetchCpuStatus("ABC123");

    expect(result).toEqual({ status: "fetch-failed" });
  });

  it("value가 JSON으로 파싱되지 않으면 임의의 CPU 값을 만들지 않고 형식 오류 상태가 된다", async () => {
    mockFetchOnce({ ok: true, json: async () => ({ value: "이건 JSON이 아님" }) });

    const result = await fetchCpuStatus("ABC123");

    expect(result).toEqual({ status: "invalid-format" });
  });

  it("cpuPercent 또는 measuredAt 필드가 없으면 임의의 값을 만들지 않고 형식 오류 상태가 된다", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => ({ value: JSON.stringify({ cpuPercent: 42.3 }) }),
    });

    const result = await fetchCpuStatus("ABC123");

    expect(result).toEqual({ status: "invalid-format" });
  });
});
