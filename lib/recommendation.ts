import type { ComprehensiveDiagnosis, DiagnosisResourceKey } from "./comprehensive-diagnosis";

export type Recommendation = {
  title: string;
  steps: string[];
};

const RESOURCE_GUIDANCE: Record<DiagnosisResourceKey, (processSummary: string | null) => Recommendation> = {
  cpu: (processSummary) => ({
    title: "CPU 사용률이 높게 관찰된 프로그램이 있어요",
    steps: [
      processSummary
        ? `${processSummary}가 CPU를 높게 사용하는 것으로 관찰됐습니다. 지금 필요한 작업인지 확인해보세요.`
        : "CPU 사용률이 높게 관찰됐습니다. 작업 관리자에서 어떤 프로그램이 CPU를 많이 쓰는지 확인해보세요.",
      "필요 없는 작업이라면 직접 종료를 검토해보세요.",
      '종료 후에는 "조치 후 다시 분석"으로 변화를 확인해보세요.',
    ],
  }),
  ram: (processSummary) => ({
    title: "메모리를 높게 사용하는 것으로 관찰된 프로그램이 있어요",
    steps: [
      processSummary
        ? `${processSummary}가 메모리를 높게 사용하는 것으로 관찰됐습니다. 지금 사용하지 않는 프로그램/탭인지 확인해보세요.`
        : "메모리 사용률이 높게 관찰됐습니다. 작업 관리자에서 메모리를 많이 쓰는 프로그램/탭을 확인해보세요.",
      "필요 없는 프로그램/탭이라면 직접 종료를 검토해보세요.",
      '종료 후에는 "조치 후 다시 분석"으로 변화를 확인해보세요.',
    ],
  }),
  disk: (processSummary) => ({
    title: "디스크 사용량이 높게 관찰된 프로그램이 있어요",
    steps: [
      processSummary
        ? `${processSummary}가 디스크를 높게 사용하는 것으로 관찰됐습니다. 파일 복사/설치/업데이트 등 지금 의도한 작업인지 확인해보세요.`
        : "디스크 사용량이 높게 관찰됐습니다. 백업, 동기화, 설치/업데이트가 진행 중인지 확인해보세요.",
      "정상적인 작업이라면 강제로 종료하기보다 완료될 때까지 기다리는 것을 검토해보세요.",
      '완료 후에는 "조치 후 다시 분석"으로 변화를 확인해보세요.',
    ],
  }),
};

const NORMAL_RECOMMENDATION: Recommendation = {
  title: "측정 범위에서는 병목 후보가 관찰되지 않았습니다",
  steps: ["계속 느리다고 느껴지면, 느려지는 그 순간에 다시 분석해보세요."],
};

const INSUFFICIENT_RECOMMENDATION: Recommendation = {
  title: "아직 측정이 충분하지 않습니다",
  steps: ["조금 더 기다린 뒤 다시 확인해보세요."],
};

// 측정하지 않은 원인을 단정하지 않는다 — process candidate가 있어도
// "이 프로그램이 원인입니다"가 아니라 "높게 관찰된 후보"로만 표현하고,
// 항상 사용자가 직접 확인/종료를 검토하는 행동으로만 안내한다. 자동
// 종료/삭제/설정 변경은 어떤 경우에도 제안하지 않는다.
export function buildRecommendation(diagnosis: ComprehensiveDiagnosis): Recommendation {
  if (diagnosis.kind === "insufficient-data") {
    return INSUFFICIENT_RECOMMENDATION;
  }
  if (diagnosis.kind === "no-candidate") {
    return NORMAL_RECOMMENDATION;
  }

  const primary = diagnosis.kind === "single-primary" ? diagnosis.primary : diagnosis.candidates[0];
  return RESOURCE_GUIDANCE[primary.resource](primary.topProcessSummary);
}
