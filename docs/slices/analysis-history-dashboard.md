# SPEC — Web: 분석 히스토리 대시보드 (화면④)

## 목표

비전공자 사용자가 "내 PC가 요즘 어땠는지"를 한 번의 측정값이 아니라
**여러 번의 실제 측정 패턴**으로 감을 잡을 수 있게 한다. 새 화면④를
만든다: 코드당 최근 20번의 분석 기록을 시간순으로 보여주는 타임라인과,
그 기록을 요약한 "최근 내 PC, 어땠나요?" 카드.

이 기능은 `docs/screens.md`가 "이번 MVP에서 만들지 않는다"고 명시했던
"분석 기록 화면"을 의도적으로 여는 것이고,
`docs/slices/real-time-performance-graph.md`가 전제로 삼았던 "서버에
장기 history를 만들지 않는다"도 이번 슬라이스에 한해 의도적으로
바꾸는 것이다 — 두 문서 모두 이 결정을 뒤집는 게 아니라, 실시간
그래프(2초 폴링, 서버 이력 없음)와 분석 히스토리(사용자 행동 단위,
서버에 짧게 보관)가 **서로 다른 목적의 서로 다른 데이터**임을
분명히 구분해서 취급한다.

GPU/네트워크/CPU온도는 PRD.md/CLAUDE.md에 명시적으로 제외돼 있어
이번에도 포함하지 않는다.

## 배경 / 이번 결정의 전제

- 로그인이 없는 프로젝트라 "코드"가 사실상 유일한 사용자 식별자다.
  코드를 잃어버리면 히스토리도 함께 잃는다 — 이건 한계로 받아들이고
  넘어간다(로그인 도입은 PRD가 명시적으로 배제).
- 기존 `session:{code}` Redis 키(최신 값 1개, TTL 1시간)는 그대로
  둔다. 실시간 그래프/성능 분석 결과 화면은 계속 이 키만 쓴다.
- 새 `history:{code}` Redis 키(List, 최근 20개, TTL **7일**)를
  추가한다. 새 데이터베이스나 새 의존성은 추가하지 않는다 — 이미
  쓰고 있는 Upstash Redis를 확장할 뿐이다.
- "언제 기록하나"는 Agent의 업로드 주기(2~5초)가 아니라 **사용자가
  실제로 분석 결과를 확인한 시점**이다. 그래야 히스토리가 "24시간
  상시 모니터링 로그"(PRD가 배제한 것)가 아니라 "사용자가 실제로
  분석해본 기록"이 된다.

## 데이터 모델

- `session:{code}` — 기존 그대로(변경 없음).
- `history:{code}` — Redis List. 원소는 Agent가 원래 올린 것과 **완전히
  동일한 원본 JSON 문자열**(새 스키마를 만들지 않는다). `LPUSH`로
  맨 앞에 추가, `LTRIM 0 19`로 최근 20개만 유지, 쓸 때마다 `EXPIRE`를
  7일(604800초)로 갱신.
- **주의(한계로 명시)**: `session:{code}`가 1시간 뒤 만료돼도
  `history:{code}`는 최대 7일간 남아있을 수 있다 — 의도된 동작이다
  (최신 상태를 모른다고 과거 기록까지 지울 이유는 없다).

## API

### `POST /api/history`

- Request: `{ code: string }` — `value`를 클라이언트가 보내지
  않는다. 클라이언트가 방금 `GET /api/data`로 받은 값을 다시
  직렬화해서 보내면 원본 payload 형태(납작한 `ramPercent` 등)와
  파싱된 형태(중첩된 `ram.percent` 등)가 달라 형태가 어긋날 위험이
  있다. 대신 서버가 **그 순간 `session:{code}`에 있는 원본 문자열을
  그대로** 읽어 히스토리에 복사한다 — 어긋날 여지 자체를 없앤다.
- 서버 처리: `session:{code}` 조회 → 없으면 400 → 있으면
  `lib/performance-status.ts`의 (새로 export하는) `parseValue`로
  `status: "received"`인지 확인 → 아니면 400 → 맞으면
  `history:{code}`에 `LPUSH` + `LTRIM 0 19` + `EXPIRE 604800`.
- Response: `{ ok: true }` 또는 `{ error: string }` 400.
- 인증 없음 — 기존 `POST /api/data`와 동일한 위협 모델(코드만 알면
  누구나 쓸 수 있음)이라 새로운 보안 퇴행은 아니다. 다만 이 프로젝트
  전체의 기존 한계이므로 그대로 인지하고 넘어간다.

### `GET /api/history?code=...`

- Response: `{ entries: string[] }` (최신이 먼저, 원본 JSON 문자열
  그대로, 최대 20개). 기록이 없으면 `{ entries: [] }`.
- 인증 없음(기존 `GET /api/data`와 동일).

### 작은 리팩터 (동작 변경 없음, 재사용을 위한 정리)

- `lib/performance-status.ts`의 현재 비공개 `parseValue` 함수에
  `export`를 붙인다 — 새 API route에서 서버 쪽에서도 같은 파싱
  로직을 재사용하기 위함(로직 자체는 손대지 않음).
- `app/api/data/route.ts`의 `keyFor(code)` 로직을 `lib/redis-keys.ts`로
  옮겨 `sessionKeyFor`/`historyKeyFor` 두 개로 정리한다(동작 동일,
  두 route 파일이 같은 키 형식을 공유하기 위함).
- Upstash `Redis` 클라이언트 생성 코드(`app/api/data/route.ts`에
  중복)를 `lib/redis-client.ts`로 뽑아 새 route와 공유한다(설정
  동일, 동작 변경 없음).

## 화면 구성 (화면④, "B. 부드러운 카드" 스타일 — 브레인스토밍에서 확정)

기존 화면①②③은 grayscale wireframe을 그대로 유지한다. 화면④만
연한 배경 + 흰 카드 + 상태 점(초록=정상/주황=병목 후보) 스타일을
적용한다 — 전체 앱을 다시 디자인하는 게 아니라 이 화면 하나에
한정된 예외임을 분명히 한다.

- 화면①(`StartScreen`)에 "히스토리 보기" 링크 추가. `inputCode`가
  있어야 활성화(기존 "성능 분석 시작"과 동일한 조건).
- 새 `app/components/HistoryScreen.tsx`:
  - 마운트 시 1회 `GET /api/history?code=...` 조회(폴링 아님 — 과거
    기록을 보는 화면이라 실시간 갱신이 필요 없다).
  - **빈 상태**: "아직 분석 기록이 없어요. 성능 분석을 먼저
    진행해보세요" + 화면①로 돌아가는 링크.
  - **로딩/에러**: 기존 화면들과 동일한 관례(에러 시 마지막 성공
    데이터를 유지하는 로직은 필요 없음 — 1회성 조회라 단순히
    "조회 실패, 다시 시도" 문구만).
  - **요약 카드**: `summarizeHistory`가 만든 한 줄 헤드라인(아래
    "계산 로직" 참고).
  - **타임라인**: 각 기록마다 시각 + 한 줄 상태(`describeHistoryEntries`
    결과) + 상태 점. 클릭해서 그 시점 상세 근거를 펼쳐보는 기능은
    이번엔 만들지 않는다(YAGNI, 나중에 추가하기 쉬운 구조로만
    남겨둠 — 각 항목이 이미 파싱된 `ReceivedStatus`를 들고 있으므로
    나중에 `evaluateComprehensiveDiagnosis` 결과를 펼쳐 보여주는 건
    추가 데이터 없이도 가능).
  - "← 시작 화면" 링크(기존 관례와 동일).

## 계산 로직 (신규 순수 함수, TDD 대상)

`lib/history-summary.ts`(가칭). 입력은 이미 `parseValue`로 파싱해
`status: "received"`인 것만 걸러낸 `ReceivedStatus[]`(최신이 먼저)다.

```ts
export type HistorySummary =
  | { kind: "empty" }
  | {
      kind: "summary";
      totalCount: number;
      candidateCount: number;
      topResourceLabel: string | null; // "RAM" | "RAM, Disk"(동률) | null(후보 0건)
      headline: string;
    };

export type HistoryEntry = {
  measuredAt: string;
  statusLabel: string; // "정상" | "RAM 병목 후보" | "RAM, Disk 동시 병목 후보" | "데이터 부족"
};

export function summarizeHistory(statuses: ReceivedStatus[]): HistorySummary;
export function describeHistoryEntries(statuses: ReceivedStatus[]): HistoryEntry[];
```

- 둘 다 기존 `evaluateComprehensiveDiagnosis`(수정하지 않음)를 각
  기록에 그대로 적용해서 재사용한다 — 새로운 판정 로직을 만들지
  않는다.
- `describeHistoryEntries`: `kind`가 `"insufficient-data"`면 "데이터
  부족", `"no-candidate"`면 "정상", `"single-primary"`면
  `"${primary.label} 병목 후보"`, `"tied-primary"`면
  `"${candidates.map(c=>c.label).join(', ')} 동시 병목 후보"`.
- `summarizeHistory`: `statuses`가 비어있으면 `{kind: "empty"}`.
  아니면 `candidateCount`는 `single-primary`/`tied-primary`인
  기록 수. `topResourceLabel`은 모든 기록의 후보 리소스(단일이든
  동시든 전부)를 누적 집계해서 가장 많이 등장한 리소스(동률이면
  CPU→RAM→Disk 순서로 나열, 기존 관례와 동일). `headline`:
  - `totalCount === 1`이면
    `"가장 최근 분석: ${describeHistoryEntries 결과의 첫 항목 statusLabel}"`.
  - `candidateCount === 0`이면
    `"측정한 범위에서 최근 ${totalCount}번 모두 병목 후보가 발견되지 않았습니다"`.
  - 그 외`"최근 ${totalCount}번 중 ${candidateCount}번 ${topResourceLabel} 병목 후보 감지됨"`.

`lib/performance-status.ts`에 추가:

```ts
export function fetchHistoryEntries(code: string): Promise<
  | { status: "invalid-code" }
  | { status: "fetch-failed" }
  | { status: "ok"; entries: ReceivedStatus[] }
>;
```

- `GET /api/history?code=...` 호출 → 각 원소를 (새로 export한)
  `parseValue`로 파싱 → `status !== "received"`인 항목은 조용히
  걸러낸다(측정되지 않은 것처럼 취급, 예외로 죽지 않음).

## 저장 시점 (호출 지점)

`app/page.tsx`의 아래 세 지점 — "사용자가 실제로 분석을 실행한"
지점 — 에서만, `fetchPerformanceStatus` 결과가 `"received"`일 때
`POST /api/history`를 fire-and-forget으로 호출한다(실패해도 조용히
무시 — 화면 표시를 방해하지 않는 부가 기능이다):

1. `startAnalysis()` (화면① → "성능 분석 시작")
2. `requestReanalysis()` (화면② → "조치 후 다시 분석")
3. `reanalyzeInCompare()` (화면③ → "다시 분석")

**기록하지 않는 지점**: `checkConnection()`(화면①의 "연결 확인" —
분석이 아니라 연결 여부 확인일 뿐), `AnalysisScreen`의 2초 폴링
tick(이미 합의한 대로 — 안 그러면 순식간에 수백 건이 쌓여 사실상
상시 모니터링이 된다).

## 완료 조건 (눈으로 확인)

1. 화면①에서 "히스토리 보기"를 누르면 화면④로 이동한다.
2. 기록이 하나도 없으면 빈 상태 문구가 보인다.
3. "성능 분석 시작"을 몇 번 반복한 뒤 화면④에 들어가면, 그 횟수만큼
   타임라인에 기록이 쌓여 있고 각 기록의 상태 문구가 그때 실제
   측정값과 일치한다.
4. 요약 카드 헤드라인이 실제 기록 개수/병목 횟수와 맞아떨어진다.
5. 2초 폴링 중에는(화면② 대기) 히스토리가 늘어나지 않는다 —
   "성능 분석 시작"/"조치 후 다시 분석"/"다시 분석"을 눌렀을 때만
   늘어난다.

## 이번 슬라이스에서 안 하는 것

- 개별 기록 삭제/편집
- 기록 클릭 시 상세 근거 펼쳐보기(구조는 남겨두되 이번엔 미구현)
- "자주 등장하는 프로세스 랭킹", "쉬운 말 설명", "조치 전후 누적
  비교 그래프" — 브레인스토밍에서 다음 단계로 미룬 아이디어들
- 로그인, 여러 코드를 하나로 묶어 보는 기능
- GPU/네트워크/CPU온도
- 화면①②③의 grayscale 스타일 변경(화면④만 예외)
- CPU/RAM/Disk 판정 로직, 종합진단 로직 변경(전부 그대로 재사용만)

## 테스트 계획

`lib/history-summary.ts` 순수 함수 단위 테스트(TDD):

1. 빈 배열 → `{kind: "empty"}`.
2. 기록 1개, 병목 후보 → `totalCount:1`, headline이 "가장 최근
   분석: ..." 형태.
3. 기록 5개 중 3개가 RAM 병목 후보 → `candidateCount: 3`,
   `topResourceLabel: "RAM"`, headline이 정확히 "최근 5번 중 3번
   RAM 병목 후보 감지됨".
4. 후보가 0건인 기록만 있을 때 → "모두 병목 후보가 발견되지
   않았습니다" 문구.
5. RAM과 Disk가 동률로 자주 등장 → `topResourceLabel: "RAM, Disk"`.
6. `describeHistoryEntries`가 4가지 라벨(정상/단일 후보/동시
   후보/데이터 부족)을 각각 올바르게 만든다.

`lib/performance-status.ts`의 `fetchHistoryEntries` 테스트(기존
`fetchPerformanceStatus` 테스트와 동일한 방식 — `fetch` mock):

7. 정상 응답 → 파싱된 `ReceivedStatus[]` 반환.
8. 응답에 파싱 불가능한 항목이 섞여 있으면 그 항목만 걸러내고
   나머지는 반환.
9. 잘못된 코드 형식 → `invalid-code`, 네트워크 실패 →
   `fetch-failed`.

`app/api/history/route.ts`는 기존 `app/api/data/route.ts`와
동일하게 자동 테스트 없이 production E2E(코드 발급 → 데이터 POST →
히스토리 POST → 히스토리 GET → 왕복 확인)로 검증한다(이 프로젝트의
기존 관례 그대로).

### production 수동 확인 절차

1. Agent 연결 → "성능 분석 시작" 2~3회 반복(중간에 화면①로 갔다가
   다시 오는 식으로).
2. 화면①에서 "히스토리 보기" → 방금 한 횟수만큼 타임라인에 쌓여
   있는지 확인.
3. 요약 카드 문구가 실제 상태(정상/병목 후보)와 맞는지 확인.
4. 화면④에서 화면②로 돌아가 2초 폴링을 잠깐 지켜본 뒤 다시
   화면④에 들어가 — 폴링만으로는 기록이 안 늘어났는지 확인.
5. 코드를 새로 발급받아 화면④에 들어가 빈 상태가 보이는지 확인.

## 한계 (SPEC에 기록)

- 코드를 잃어버리면(또는 7일이 지나면) 히스토리도 함께 사라진다 —
  로그인이 없는 이 프로젝트의 근본적인 한계이며, 이번 슬라이스가
  새로 만든 문제가 아니라 이미 있던 한계를 히스토리에도 그대로
  적용한 것이다.
- 인증이 없어 코드를 아는 사람은 누구나 그 코드의 히스토리를 읽고
  쓸 수 있다 — 기존 `/api/data`와 동일한 기존 한계.
- `session:{code}`가 만료돼도 `history:{code}`는 최대 7일 더
  남아있을 수 있어, "최신 상태 없음"과 "과거 기록 있음"이 동시에
  나타날 수 있다(의도된 동작으로 취급).
