import { describe, expect, it } from "vitest";
import { buildFakeRecommendation } from "./recommendation";

describe("buildFakeRecommendation", () => {
  it("cpu가 주어지면 CPU 관련 확인 행동을 제안한다", () => {
    const result = buildFakeRecommendation("cpu");

    expect(result.resource).toBe("cpu");
    expect(result.steps.length).toBeGreaterThan(0);
    for (const step of result.steps) {
      expect(step).not.toMatch(/종료합니다|삭제합니다|변경합니다/);
    }
  });

  it("ram/disk도 각각 다른 문구를 제안한다", () => {
    const ram = buildFakeRecommendation("ram");
    const disk = buildFakeRecommendation("disk");

    expect(ram.title).not.toBe(disk.title);
  });

  it("후보가 없으면(null) 조치 단계 없이 안내 문구만 반환한다", () => {
    const result = buildFakeRecommendation(null);

    expect(result.resource).toBeNull();
    expect(result.steps).toEqual([]);
  });
});
