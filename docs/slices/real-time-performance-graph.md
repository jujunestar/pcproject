# SPEC — Web: 실시간 CPU/RAM/Disk 자동 갱신 그래프

이 문서는 SPEC만 정의한다. 이번 슬라이스에서 코드/테스트는 아직
작성하지 않는다.

## 목표

사용자가 "성능 분석 시작"을 한 번 누른 뒤에는, 분석 화면(화면②)을
보고 있는 동안 추가 클릭이나 새로고침 없이 CPU/RAM/Disk 현재값과
`UsageGraph`가 실제 Agent 측정값으로 계속 자동 갱신된다.
`lib/fake-timeseries.ts`가 만들던 예시 시계열을, 화면②가 살아있는
동안 브라우저가 반복 조회해 쌓은 **실제** 시계열로 교체한다.

**정확한 표현 (결정 완료)**: "약 2초마다 실시간 측정"이 아니라,
**"웹이 2초마다 최신 데이터를 확인하고, Agent의 새 측정값(새
`measuredAt`)이 들어와 있으면 그 즉시 화면에 반영한다"**로 정의한다.
Agent가 실제로 새 값을 만드는 주기(약 3~5초)와 웹이 확인하는 주기
(2초)는 서로 다르며, 이 차이를 화면 문구나 설계 어디에도 "2초마다
새 측정값이 생긴다"처럼 표현하지 않는다.

`agent/*.py`의 판정 함수(`evaluate_overload_status`,
`evaluate_ram_status`, `evaluate_disk_io_status`)와 그 상수는 이미
실제 Windows 환경에서 검증이 끝난 것이므로 이번 슬라이스에서 손대지
않는다. 이번 슬라이스는 오직 "이미 Agent가 계산해서 Redis에 올려둔
최신 값을, 웹이 얼마나 자주/어떻게 다시 조회해서 그래프에 쌓는가"에만
관여한다.

## 조사 결과 — 현재 실제 코드/데이터 흐름 (추측 아님, 코드에서 확인)

### 1~3. Agent 측정·업로드 간격, `cpu_percent(interval=...)`의 영향

`agent/main.py`:

```python
MEASURE_INTERVAL_SECONDS = 2
PROCESS_SAMPLE_SECONDS = 1
...
cpu_percent = measure_cpu_percent(
    lambda: psutil.cpu_percent(interval=MEASURE_INTERVAL_SECONDS)
)
```

- 루프 한 바퀴의 **하한선은 정확히 2.0초**다. `psutil.cpu_percent(interval=2)`
  자체가 2초간 블로킹하며 CPU를 측정하는 방식이라(순간값이 아니라
  구간 평균), 이 2.0초는 "오버헤드"가 아니라 측정 방법 그 자체다.
  Agent를 아무리 최적화해도 이 2.0초보다 짧게 새 CPU 측정값을 만들 수
  없다.
- 이 2초 블로킹 구간은 `disk_io_before`/`disk_io_after`를 감싸는 데도
  그대로 재사용된다(`specs/disk-analysis.md`에 이미 명시된 설계 —
  Disk 활성 시간 비율의 "샘플링 창"이 바로 이 2초다). 즉 CPU 루프
  간격을 줄이면 Disk 활성 시간 계산의 샘플링 창도 함께 줄어든다 —
  두 값이 서로 독립적이지 않다.
- 이 2.0초 위에 실제로 얹히는 추가 시간(RAM/Disk 용량 측정, upload
  네트워크 왕복 등)은 `specs/cpu-overload.md`에 실측 기록이 남아있다:
  최초 버전은 부하 없이도 **2.7~4.6초**까지 벌어졌었고, 5번째 세션
  수정(프로세스 후보 프라이밍을 "새로 확정된 주기에만" 실행하도록
  분리) 이후에는 **2.6~2.8초**로 좁혀졌다(SESSION.md 5번 항목).
  `MAX_SAMPLE_GAP_SECONDS = 10.0`은 이 실측값(약 4~5초 최악치)의
  2배 여유를 둔 값이다.
- **단, 어떤 리소스든 "새로" `-candidate` 상태로 확정되는 바로 그
  주기에는** `PROCESS_SAMPLE_SECONDS = 1`초의 추가 대기 +
  프로세스 전수 순회 프라이밍 비용(과거 실측 약 0.4~0.9초)이 그
  주기에만 한 번 더 얹힌다. 이 경우 그 한 주기는 4~5초까지 늘어날 수
  있다. 이런 주기는 "병목이 막 확정된 순간"에만 발생하고 매 주기
  반복되지 않는다.

**결론(확정)**: Agent의 실제 측정 주기는 **고정된 2초가 아니라, 평상시
약 2.6~2.8초, 병목이 막 확정되는 주기에만 예외적으로 약 4~5초**다.
이 슬라이스는 이 실측값을 "약 2초 실시간 측정"으로 포장하지 않고,
**"웹은 2초마다 확인하고, 새 측정값이 들어오면 즉시 반영한다"**로
정의하기로 확정했다 — 실제 체감 갱신 간격은 약 3~5초가 된다. Agent
루프 자체를 더 촘촘하게 만드는 것은 이번 MVP 범위 밖이다.

### 4. payload에 `measuredAt`이 존재하는가

존재한다. `agent/main.py`의 `measured_at`(UTC ISO8601 문자열, 그
주기 시작 시점에 한 번 생성)이 CPU/RAM/Disk 세 필드 모두에 **동일하게**
재사용되어 `build_measurement_value(... measured_at=measured_at ...)`로
그대로 올라간다. 웹 쪽 `lib/performance-status.ts`의 `PerformanceStatus`
`"received"` 케이스에도 최상위 `measuredAt: string`으로 이미 존재하고
파싱된다 (`typeof measuredAt !== "string"`이면 애초에
`invalid-format`으로 걸러짐 — 항상 존재를 보장).

### 5. `GET /api/data`가 반환하는 구조

`app/api/data/route.ts`: `redis.get<string>(keyFor(code))` — code당
Redis 키 하나에 **최신 값 1개만** 저장(POST마다 덮어쓰기, TTL
3600초). 이력이 전혀 없다. 즉 "실시간 그래프"에 필요한 시계열은
서버 어디에도 없고, **웹이 반복 조회해서 직접 쌓는 것 말고는 얻을
방법이 없다** — 이는 이미 `docs/screens.md`에서 확인된 사실과 동일하며
이번 슬라이스에서도 그대로 전제로 삼는다.

### 6. 병목 판정 history와 실시간 화면 갱신의 분리

이 둘은 **이미 코드 구조상 완전히 분리돼 있다** — 이번 슬라이스에서
분리 작업을 새로 할 필요가 없다.

- `agent/main.py`의 `cpu_history`/`ram_history`/`disk_history`는
  Agent 프로세스 **내부 메모리에만** 존재한다. 판정 함수
  (`evaluate_*_status`)가 참조하는 이 이력은 Redis에 저장되지 않고,
  `/api/data` payload에도 원본 이력 그대로는 절대 포함되지 않는다 —
  포함되는 것은 그 이력을 바탕으로 이미 계산이 끝난 **결과**
  (`overloadStatus`/`overloadEvidence`, `ramStatus`/`ramEvidence`,
  `diskIoStatus`/`diskIoEvidence`)뿐이다.
- 따라서 웹이 만들 "실시간 그래프용 샘플 목록"은 Agent의 판정용
  이력과는 **완전히 다른, 새로운, 브라우저 메모리에만 존재하는
  이력**이다. 이걸 만든다고 해서 Agent의 판정 이력이나
  `evaluate_*_status` 로직에는 어떤 영향도 주지 않는다 (건드릴 필요
  자체가 없다).

## 완료 조건 (눈으로 확인, 최대 5개)

1. "성능 분석 시작"을 누른 뒤, 화면을 더 누르지 않아도 CPU/RAM/Disk
   현재값 숫자가 시간이 지나면서 자동으로 바뀐다.
2. 실제로 CPU 부하를 걸면(예: 기존에 쓰던 안전한 PowerShell 부하
   스크립트), 화면을 아무것도 조작하지 않아도 CPU 현재값과
   `UsageGraph`가 상승하는 것이 보인다.
3. `UsageGraph`의 각 점이 `lib/fake-timeseries.ts`가 아니라, 실제로
   서로 다른 `measuredAt`을 가진 값들이 시간 순서(왼쪽=과거,
   오른쪽=최신)로 찍힌다.
4. 부하를 종료하면, 이어지는 자동 갱신에서 값과 그래프가 다시
   낮아지는 방향으로 움직이는 것이 보인다.
5. 화면②를 벗어나면(뒤로가기로 화면①로 이동 등) 그 이후로는 추가
   `GET /api/data` 조회가 더 이상 발생하지 않는다(Agent 콘솔의 업로드
   로그 빈도가 화면②를 볼 때와 달라지지 않는 것으로 간접 확인
   가능 — Agent 자체 루프는 웹의 폴링과 무관하게 계속 돈다).

## 데이터 흐름 설계

```
Agent (기존 그대로, 수정 없음)
  → POST /api/data (기존 그대로)
    → Redis 최신값 1개 (기존 그대로)
      → 화면②가 보이고(mounted) + 브라우저 탭이 visible인 동안만,
        2000ms 간격으로 GET /api/data 반복 조회 (신규)
        → 새 measuredAt인지 확인 (신규)
          → 새 값이면: 브라우저 메모리의 sample 목록에 추가 + 최근 20개만 유지 (신규)
          → 같은 값이면: 아무것도 안 하고 다음 조회를 기다림 (신규)
        → 현재값 표시 + UsageGraph를 이 sample 목록으로 그림 (기존 UsageGraph 컴포넌트 재사용, series만 fake→real로 교체)
```

### 신규 순수 함수 (제안, TDD 대상 — 이번 슬라이스에서는 작성하지 않음)

`lib/live-samples.ts`(가칭):

```ts
type LiveSample = {
  measuredAt: string;
  cpuPercent: number;
  ramPercent: number | null;
  diskActivePercent: number | null;
};

function appendSampleIfNew(
  existing: LiveSample[],
  status: ReceivedStatus,
  maxSamples: number
): LiveSample[];
```

- `existing`이 비어있거나, `existing`의 **마지막** 항목의
  `measuredAt`과 `status.measuredAt`이 다르면 새 sample을 끝에
  추가한 뒤 `maxSamples`를 넘는 앞부분을 잘라낸다.
- 마지막 항목과 `measuredAt`이 같으면 `existing`을 그대로(참조 동일)
  반환한다 — 중복 추가 금지, 그래프 리렌더도 불필요해짐.
- `maxSamples`는 **20으로 확정**한다.
- Agent의 `trim_history`(판정용, `agent/cpu_agent.py` 등)와는
  이름만 비슷할 뿐 완전히 다른, 새로운 함수다. 기존 판정 로직을
  전혀 import하거나 참조하지 않는다.

`lib/live-samples.ts`(가칭)에 함께 둘 두 번째 순수 함수(연결 불안정
표시 판단용, 결정 4):

```ts
function shouldShowConnectionWarning(consecutiveFailureCount: number): boolean;
```

- `consecutiveFailureCount >= 3`이면 `true`(화면에 "연결 불안정"
  표시), 그 미만이면 `false`.
- 폴링 tick이 성공(`received`)할 때마다 `consecutiveFailureCount`는
  0으로 리셋된다 — 그 다음 tick부터 다시 `false`가 되어 표시가
  자동으로 해제된다.
- 실패로 카운트하는 것은 `fetch-failed`/`invalid-format`/
  `invalid-code`뿐이다. `no-data`(아직 Agent가 값을 안 올린 정상적인
  대기 상태)는 실패로 세지 않는다 — 연결 문제가 아니라 데이터가
  아직 없는 것뿐이기 때문이다.

### 폴링 생명주기 (컴포넌트 쪽 설계, 순수 함수 아님)

- 화면②(`AnalysisScreen`)가 "받은 상태가 `status: "received"`"인
  동안에만 폴링이 진행된다.
- 폴링 시작 시점: 기존 "성능 분석 시작"이 트리거하는 최초 1회
  `fetchPerformanceStatus`가 성공적으로 끝난 뒤부터. (최초 로딩
  상태는 지금처럼 1회만 보여주고, 이후 폴링 tick은 그 로딩 화면을
  다시 띄우지 않는다 — 폴링은 화면을 가리지 않는 배경 동작이어야
  한다.)
- 폴링 간격: **2000ms 고정**.
- 폴링 종료 시점: `AnalysisScreen`이 언마운트될 때(화면①로 돌아가거나
  화면③으로 이동할 때). React의 일반적인 `useEffect` cleanup으로
  자연스럽게 해결되는 부분이라 별도 "정지 신호" 설계가 필요 없다.
- **탭 visibility 처리(결정 5, 확정)**: `document.visibilitychange`를
  구독해, `document.hidden === true`가 되면 진행 중인 폴링
  interval을 멈춘다(그동안은 조회 자체를 하지 않음 — 오류 아님,
  정상 동작). `document.hidden === false`로 돌아오면 **다음 2000ms
  tick을 기다리지 않고 그 즉시 1회 조회를 실행**한 뒤, 그 결과를
  기준으로 다시 2000ms 간격 폴링을 재개한다.
- 폴링 tick마다: `fetchPerformanceStatus(inputCode)` 호출 →
  - 성공(`received`) → `appendSampleIfNew`로 sample 목록 갱신 +
    "마지막으로 성공한 상태"(`lastGoodStatus`)를 이 값으로 교체 +
    `consecutiveFailureCount`를 0으로 리셋.
  - 실패/무데이터(`fetch-failed`, `no-data`, `invalid-format`,
    `invalid-code`) → `lastGoodStatus`와 sample 목록은 **건드리지
    않는다.** 화면은 계속 마지막으로 성공한 값을 그대로 보여준다
    (아래 "안 되는 경우" 참고). `no-data`를 제외한 나머지는
    `consecutiveFailureCount`를 1 증가시킨다.
- 화면에 실제로 표시하는 현재값/그래프는 매 tick의 즉시 결과가 아니라
  **`lastGoodStatus` 기준**이다. 이렇게 하면 일시적 실패 한 번이
  화면을 비우거나 오류로 바꾸지 않는다.
- `shouldShowConnectionWarning(consecutiveFailureCount)`가 `true`인
  동안, 기존 화면 레이아웃(숫자/그래프/상세 섹션)은 그대로 두고 그
  위에 작은 "연결 불안정" 문구만 추가로 보여준다 — 화면을 error
  상태로 통째로 바꾸지 않는다.

## 안 되는 경우

| 상황 | 처리 |
|---|---|
| Agent가 실행되지 않음 / 아직 첫 데이터가 없음 | `GET /api/data` → `{value: null}` → 기존과 동일하게 "no-data" 상태 표시. 폴링은 계속하며, 데이터가 도착하면 그 즉시 정상 화면으로 전환된다. 실패로 세지 않는다(`consecutiveFailureCount` 증가 없음). |
| API 일시 실패 1~2회 연속 (`fetch-failed` 등) | **화면을 즉시 비우거나 오류로 바꾸지 않는다.** 마지막으로 성공한 값/그래프를 그대로 유지하고, 조용히 다음 폴링에서 회복을 시도한다. (단, 최초 진입 시 첫 조회부터 실패하면 표시할 "마지막 성공 값" 자체가 없으므로 기존 error 상태를 그대로 보여준다 — 이건 기존 동작 유지.) |
| API 실패가 **3회 연속** 이상 | 위와 동일하게 마지막 성공 값/그래프는 유지하되, 화면에 작은 "연결 불안정" 표시를 추가로 보여준다(`shouldShowConnectionWarning`). 화면 전체를 error로 바꾸지 않는다. |
| 실패 이후 다음 조회가 성공함 | `consecutiveFailureCount`가 0으로 리셋되어 "연결 불안정" 표시가 자동으로 사라진다. |
| 새 데이터가 아직 도착하지 않음(`measuredAt` 동일) | `appendSampleIfNew`가 그대로 반환 → 그래프에 점 추가 없음, 현재값도 그대로 유지. 오류 아님, 조용히 다음 폴링을 기다린다. |
| 같은 `measuredAt`을 다시 조회함 | 위와 동일. |
| 구버전 Agent라 RAM/Disk 값이 없음(`ram`/`disk`가 `null`) | 기존 `PerformanceStatus`의 null 처리 관례를 그대로 따른다. CPU 값/그래프는 계속 갱신되고, RAM/Disk는 "데이터 부족"으로 표시되며 해당 시계열은 쌓이지 않는다(억지로 값을 채우지 않음 — PRD 암묵지 그대로). |
| 브라우저 탭이 background/hidden 상태가 됨 | 폴링을 멈춘다. 오류가 아니며 화면 표시도 바꾸지 않는다(사용자가 안 보고 있으므로). |
| 탭이 다시 visible 상태가 됨 | 다음 정기 tick을 기다리지 않고 즉시 1회 조회한 뒤 2000ms 폴링을 재개한다. |

## 이번 슬라이스에서 안 하는 것

- 추천 행동("지금 해볼 것") 실제 로직
- 조치 전후 비교("화면③") 실제 연결
- 서버 측 측정 history 저장 (Redis 구조 변경 없음)
- 24시간/상시 모니터링
- 분석 기록 저장, 로그인
- 새 화면 추가
- 최종 디자인/스타일링 변경
- 새 차트 라이브러리 설치 (기존 `UsageGraph` SVG 컴포넌트 재사용,
  `series` prop만 fake→real로 교체)
- CPU/RAM/Disk 병목 판정 기준(`*_HIGH_THRESHOLD_PERCENT`,
  `MIN_SUSTAINED_SECONDS`, `MAX_SAMPLE_GAP_SECONDS` 등) 변경
- 자동 프로세스 종료

## 테스트 계획

`lib/live-samples.ts`(가칭)에 대한 순수 함수 단위 테스트 (TDD, 이번
문서 작성 단계에서는 미작성):

1. `measuredAt A` 수신 → sample 1개 추가됨.
2. 같은 `measuredAt A` 재수신 → 목록이 그대로(길이/내용 불변, 중복
   추가 안 됨).
3. `measuredAt B` 수신(A와 다름) → sample이 2개로 늘어나고, 순서상
   B가 마지막.
4. 21번째 서로 다른 `measuredAt`을 수신하면 가장 오래된 sample부터
   잘려나가고 목록 길이가 20을 넘지 않는다.
5. `ram`/`disk`가 `null`인 payload를 받아도 예외 없이 CPU만 있는
   sample이 추가된다.
6. `shouldShowConnectionWarning(0)`, `(1)`, `(2)` → `false`;
   `(3)`, `(4)` → `true`.

컴포넌트 폴링 생명주기(useEffect 기반)는 이 프로젝트에 아직
컴포넌트/DOM 렌더 테스트 인프라가 없으므로(이번 wireframe 슬라이스에서
`react-dom/server` 정적 렌더링 스모크 테스트만 추가함), 폴링
시작/정지 자체를 자동 테스트하기보다 위 순수 함수 테스트 +
아래 production 수동 확인으로 검증한다. (자동 컴포넌트 테스트가
필요하다고 판단되면 별도로 상의 후 결정 — 새 테스트 라이브러리 추가
여부이므로 이번 슬라이스 범위 밖.)

### production 수동 확인 절차

1. Agent 실행, 연결 코드로 연결.
2. "성능 분석 시작" 클릭.
3. 화면을 조작하지 않고 대기 — CPU/RAM/Disk 현재값이 몇 초 간격으로
   스스로 바뀌는지 관찰.
4. 별도 창에서 (기존에 검증에 썼던) 안전한 PowerShell CPU 부하 스크립트
   실행.
5. 화면을 건드리지 않아도 CPU 현재값과 `UsageGraph`가 상승하는지
   확인.
6. 부하 종료.
7. 화면을 건드리지 않아도 값과 그래프가 다시 내려오는지 확인.
8. (탭 visibility 확인) 다른 탭으로 잠깐 전환했다가 화면②로 돌아와,
   자리를 비운 동안 폴링이 멈춰 있었고 복귀 즉시 새 값을 바로
   가져오는지 확인.
9. (연결 불안정 표시 확인, 가능하다면) 네트워크를 잠깐 끊어 3회 이상
   연속 실패를 유도한 뒤 "연결 불안정" 표시가 뜨는지, 네트워크
   복구 후 자동으로 사라지는지 확인.

## Agent 수정이 필요한가 — 결론

**이번 슬라이스에서는 Agent를 수정하지 않는다.**

근거:
- 위 "조사 결과 1~3"에서 확인했듯, `psutil.cpu_percent(interval=2)`의
  2.0초는 측정 방법 자체의 하한선이라 더 줄일 수 없고, 그 위에 얹히는
  실측 오버헤드는 이미 5번째 세션 수정으로 2.6~2.8초까지 좁혀져 있어
  추가로 짜낼 여지가 크지 않다.
- Disk 활성 시간 비율이 바로 이 2초 블로킹 구간을 샘플링 창으로
  재사용하고 있어서, 이 간격을 더 줄이면 이미 실제 Windows에서
  검증이 끝난 Disk 측정치의 의미(그 구간 동안의 디스크 활성 비율)
  자체가 달라진다 — "판정 알고리즘은 바꾸지 않는다"는 이번 요청의
  전제와 충돌할 위험이 있다.
- "약 2초마다 값이 도착"이 아니라 "약 2.6~5초마다 새 값이 도착하고,
  웹은 그보다 촘촘히(2000ms 간격으로) 조회해 새 값이 오는 즉시
  잡아챈다"는 모델로, 사용자 체감상 "자동으로 계속 갱신되는 그래프"라는
  목표를 Agent를 건드리지 않고 달성한다. 정확한 표현은 위 "목표"의
  확정 문구를 따른다.

## 결정 사항 (확정, 2026-08-29)

앞서 "물어볼 것"으로 남겼던 5개 항목에 대한 답이 모두 왔다. 이 SPEC은
아래 결정을 전부 반영했다.

1. Agent는 이번 슬라이스에서 수정하지 않는다. 실제 새 측정값 반영
   주기는 현재 구조상 약 3~5초로 받아들인다. "약 2초 실시간 측정"
   대신 "웹은 2초마다 최신 데이터를 확인하고, 새 측정값이 들어오면
   즉시 반영한다"로 정의한다. Agent 루프 최적화는 이번 MVP 범위
   밖이다.
2. 웹 폴링 간격은 **2000ms로 확정**한다. 같은 `measuredAt`이면
   그래프에 중복 sample을 추가하지 않는다.
3. 브라우저에 유지할 sample은 **최근 20개**로 확정한다.
4. fetch가 1~2회 실패하면 기존 데이터/그래프를 유지하며 조용히
   재시도한다. **3회 연속 실패하면** 작은 "연결 불안정" 상태를
   표시한다. 이후 fetch가 성공하면 자동으로 해제된다.
5. 브라우저 탭이 background/hidden 상태일 때는 폴링을 중지한다.
   다시 visible이 되면 즉시(다음 정기 tick을 기다리지 않고) 폴링을
   재개한다.

더 이상 열려 있는 질문은 없다. 다음 단계(TDD 구현)로 진행할 준비가
됐다.
