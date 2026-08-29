// 와이어프레임 전용 placeholder다. 실제 추천 로직(측정 근거에 따라 문구를
// 정교하게 고르는 것)은 이번 단계 범위 밖이며, 리소스 종류별로 미리 정해둔
// 고정 문구만 보여준다. 자동 실행처럼 보이지 않도록 항상 "확인해보세요"
// 같은, 사용자가 직접 하는 확인 행동으로만 문구를 구성한다.

export type RecommendationResource = "cpu" | "ram" | "disk";

export type FakeRecommendation = {
  resource: RecommendationResource | null;
  title: string;
  steps: string[];
};

const RECOMMENDATIONS: Record<RecommendationResource, FakeRecommendation> = {
  cpu: {
    resource: "cpu",
    title: "CPU 사용률이 높은 프로그램 확인해보기",
    steps: [
      "작업 관리자를 열어 CPU 사용률이 높은 프로그램을 확인해보세요.",
      "당장 필요하지 않은 프로그램이라면 직접 종료를 검토해보세요.",
    ],
  },
  ram: {
    resource: "ram",
    title: "메모리를 많이 쓰는 프로그램 확인해보기",
    steps: [
      "작업 관리자에서 메모리 사용량이 높은 프로그램을 확인해보세요.",
      "열려 있는 브라우저 탭/프로그램 중 안 쓰는 것을 직접 정리해보세요.",
    ],
  },
  disk: {
    resource: "disk",
    title: "디스크를 많이 쓰는 프로그램 확인해보기",
    steps: [
      "백업, 동기화, 압축 프로그램이 지금 실행 중인지 확인해보세요.",
      "대용량 파일 복사/다운로드가 동시에 진행 중인지 확인해보세요.",
    ],
  },
};

const NO_CANDIDATE_RECOMMENDATION: FakeRecommendation = {
  resource: null,
  title: "지금은 특별히 확인해볼 병목 후보가 없습니다.",
  steps: [],
};

export function buildFakeRecommendation(
  primaryResource: RecommendationResource | null
): FakeRecommendation {
  if (primaryResource === null) {
    return NO_CANDIDATE_RECOMMENDATION;
  }
  return RECOMMENDATIONS[primaryResource];
}
