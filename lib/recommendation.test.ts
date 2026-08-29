import { describe, expect, it } from "vitest";
import { buildRecommendation } from "./recommendation";
import type { CandidateDetail, ComprehensiveDiagnosis, NonCandidateDetail } from "./comprehensive-diagnosis";

function candidate(resource: "cpu" | "ram" | "disk", topProcessSummary: string | null): CandidateDetail {
  const label = resource === "cpu" ? "CPU" : resource === "ram" ? "RAM" : "Disk";
  return {
    kind: "candidate",
    resource,
    label,
    durationSeconds: 6.0,
    maxValueLabel: "96.0%",
    startedAt: "t1",
    endedAt: "t2",
    topProcessSummary,
  };
}

function nonCandidate(resource: "cpu" | "ram" | "disk"): NonCandidateDetail {
  const label = resource === "cpu" ? "CPU" : resource === "ram" ? "RAM" : "Disk";
  return { kind: "non-candidate", resource, label, state: "normal", shortSummary: "정상 (10.0%)" };
}

describe("buildRecommendation", () => {
  it("insufficient-data면 측정이 더 필요하다고 안내한다", () => {
    const diagnosis: ComprehensiveDiagnosis = {
      kind: "insufficient-data",
      headline: "아직 판단할 데이터가 부족합니다",
    };

    const result = buildRecommendation(diagnosis);

    expect(result.title).toContain("측정");
    expect(result.steps.join(" ")).toMatch(/다시 확인|기다린 뒤/);
  });

  it("no-candidate면 병목 후보가 관찰되지 않았다고 안내하고 다시 분석을 안내한다", () => {
    const diagnosis: ComprehensiveDiagnosis = {
      kind: "no-candidate",
      headline: "측정한 CPU/RAM/Disk 범위에서 병목 후보가 발견되지 않았습니다",
      resources: [nonCandidate("cpu"), nonCandidate("ram"), nonCandidate("disk")],
    };

    const result = buildRecommendation(diagnosis);

    expect(result.title).toContain("병목 후보가 관찰되지 않았");
    expect(result.steps.join(" ")).toContain("다시 분석");
  });

  it("CPU 병목 후보 + 관련 프로세스가 있으면 그 프로세스 정보를 안내에 포함하고 직접 종료 검토를 안내한다", () => {
    const diagnosis: ComprehensiveDiagnosis = {
      kind: "single-primary",
      headline: "가장 의심되는 병목 후보: CPU",
      primary: candidate("cpu", "chrome.exe (PID 111, CPU 95.0%)"),
      secondaryCandidates: [],
      others: [nonCandidate("ram"), nonCandidate("disk")],
    };

    const result = buildRecommendation(diagnosis);
    const text = result.steps.join(" ");

    expect(text).toContain("chrome.exe (PID 111, CPU 95.0%)");
    expect(text).toContain("필요한 작업인지");
    expect(text).toMatch(/직접 종료를 검토/);
    expect(text).toContain("조치 후 다시 분석");
  });

  it("CPU 병목 후보인데 관련 프로세스 후보가 없으면(null) 일반적인 안내로 대체한다", () => {
    const diagnosis: ComprehensiveDiagnosis = {
      kind: "single-primary",
      headline: "가장 의심되는 병목 후보: CPU",
      primary: candidate("cpu", null),
      secondaryCandidates: [],
      others: [],
    };

    const result = buildRecommendation(diagnosis);

    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.steps.join(" ")).not.toContain("null");
  });

  it("RAM 병목 후보면 탭/프로그램 정리를 안내하고 CPU와 다른 문구를 쓴다", () => {
    const cpuResult = buildRecommendation({
      kind: "single-primary",
      headline: "",
      primary: candidate("cpu", null),
      secondaryCandidates: [],
      others: [],
    });
    const ramResult = buildRecommendation({
      kind: "single-primary",
      headline: "",
      primary: candidate("ram", "powershell.exe (PID 5336, 7007.3MB)"),
      secondaryCandidates: [],
      others: [],
    });

    expect(ramResult.title).not.toBe(cpuResult.title);
    expect(ramResult.steps.join(" ")).toMatch(/탭/);
  });

  it("Disk 병목 후보면 강제 종료를 권하지 않고 완료까지 기다리는 것을 안내한다", () => {
    const diagnosis: ComprehensiveDiagnosis = {
      kind: "single-primary",
      headline: "",
      primary: candidate("disk", "chrome.exe (PID 8821, 512.4KB/s)"),
      secondaryCandidates: [],
      others: [],
    };

    const result = buildRecommendation(diagnosis);
    const text = result.steps.join(" ");

    expect(text).toContain("의도한 작업인지");
    expect(text).toMatch(/기다리는 것을 검토/);
    expect(text).not.toMatch(/직접 종료를 검토/);
  });

  it("동시 병목 후보(tied-primary)면 첫 번째(CPU→RAM→Disk 순서) 후보를 기준으로 안내한다", () => {
    const diagnosis: ComprehensiveDiagnosis = {
      kind: "tied-primary",
      headline: "동시에 감지된 병목 후보: RAM, Disk",
      candidates: [candidate("ram", null), candidate("disk", null)],
      others: [],
    };

    const result = buildRecommendation(diagnosis);

    expect(result.steps.join(" ")).toMatch(/탭/);
  });

  it("어떤 안내 문구도 자동 종료/삭제/설정 변경을 실행한다고 말하지 않는다", () => {
    const scenarios: ComprehensiveDiagnosis[] = [
      { kind: "insufficient-data", headline: "" },
      { kind: "no-candidate", headline: "", resources: [] },
      {
        kind: "single-primary",
        headline: "",
        primary: candidate("cpu", "x.exe"),
        secondaryCandidates: [],
        others: [],
      },
      {
        kind: "single-primary",
        headline: "",
        primary: candidate("ram", "x.exe"),
        secondaryCandidates: [],
        others: [],
      },
      {
        kind: "single-primary",
        headline: "",
        primary: candidate("disk", "x.exe"),
        secondaryCandidates: [],
        others: [],
      },
    ];

    for (const diagnosis of scenarios) {
      const result = buildRecommendation(diagnosis);
      const text = [result.title, ...result.steps].join(" ");
      expect(text).not.toMatch(/자동으로 종료|자동으로 삭제|설정을 변경합니다/);
    }
  });
});
