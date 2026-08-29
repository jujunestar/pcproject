import { describe, expect, it } from "vitest";
import { buildFakeUsageSeries } from "./fake-timeseries";

describe("buildFakeUsageSeries", () => {
  it("8개 지점을 0s 간격 5초로 생성한다", () => {
    const series = buildFakeUsageSeries({ cpu: 50, ram: 60, disk: 5 });

    expect(series).toHaveLength(8);
    expect(series.map((p) => p.label)).toEqual([
      "0s",
      "5s",
      "10s",
      "15s",
      "20s",
      "25s",
      "30s",
      "35s",
    ]);
  });

  it("마지막 지점은 항상 실제 현재값과 정확히 같다", () => {
    const series = buildFakeUsageSeries({ cpu: 72.3, ram: 91.1, disk: 18.4 });
    const last = series[series.length - 1];

    expect(last.cpu).toBe(72.3);
    expect(last.ram).toBe(91.1);
    expect(last.disk).toBe(18.4);
  });

  it("현재값이 null이면 기본값으로 대체한다", () => {
    const series = buildFakeUsageSeries({ cpu: null, ram: null, disk: null });
    const last = series[series.length - 1];

    expect(last.cpu).toBe(20);
    expect(last.ram).toBe(30);
    expect(last.disk).toBe(10);
  });

  it("음수 값은 만들지 않는다", () => {
    const series = buildFakeUsageSeries({ cpu: 1, ram: 1, disk: 1 });

    for (const point of series) {
      expect(point.cpu).toBeGreaterThanOrEqual(0);
      expect(point.ram).toBeGreaterThanOrEqual(0);
      expect(point.disk).toBeGreaterThanOrEqual(0);
    }
  });

  it("100%를 초과하는 Disk 활성 시간도 그대로 반영한다(잘라내지 않음)", () => {
    const series = buildFakeUsageSeries({ cpu: 20, ram: 30, disk: 132.5 });
    const last = series[series.length - 1];

    expect(last.disk).toBe(132.5);
  });
});
