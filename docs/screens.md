# screens.md — TracePC MVP 화면 3개

이번 MVP는 화면을 3개로 제한한다. 실제 코드 기준 API 분석(2026-08-29
"화면/API 매핑 1단계" 결과)을 바탕으로, 각 화면이 실제로 무엇을 하고
무엇을 부르는지 정리한다. 이 문서는 화면 구조만 정의하며, 아직 코드는
수정하지 않았다.

| 화면 이름 | 사용자가 하는 일 | 부르는 엔드포인트 | 빈 상태 | 에러 상태 |
|---|---|---|---|---|
| **① 시작 / Agent 연결** | 1. `TracePCAgent.exe` 다운로드<br>2. 연결 코드 발급 버튼 클릭<br>3. (Agent 콘솔에 코드 입력 — 웹 화면 밖에서 일어남)<br>4. 데이터 수신/연결 상태 확인 | `POST /api/code` (코드 발급)<br>`GET /api/data?code=...` (연결 확인용으로 재사용 — 새 endpoint 아님, `{value: null}`이면 "아직 미연결") | 코드 미발급 상태(발급 버튼만 보임), 코드는 있지만 아직 Agent가 값을 올리지 않은 상태(`no-data`) | 코드 발급 API 실패, 6자리 형식이 아닌 코드 입력(`invalid-code`), 조회 네트워크 실패(`fetch-failed`) |
| **② 성능 분석 결과** | 1. 종합 진단(가장 의심되는 병목 후보) 확인<br>2. 측정 근거 확인<br>3. 관련 프로세스 후보 확인<br>4. "지금 해볼 것" 안전한 조치 제안 확인<br>5. CPU/RAM/Disk 상세 확인<br>6. "조치 후 다시 분석" 클릭 | `GET /api/data?code=...` (최초 조회)<br>`GET /api/data?code=...` (동일 endpoint 재호출 — "조치 후 다시 분석" 클릭 시. 클릭 시점에 클라이언트가 현재 `performanceStatus`를 `previousStatus`로 보관한 뒤 재호출해 `currentStatus`로 받고 화면③으로 이동) | 아직 "성능 분석"을 한 번도 안 누른 상태, Agent가 아직 값을 안 올려 `no-data`인 상태 | `invalid-code`, `fetch-failed`, `invalid-format`, (RAM/Disk가 구버전 Agent라 `null`인 경우는 에러가 아니라 해당 섹션만 "데이터 부족") |
| **③ 조치 전후 비교** | 1. 이전 분석(`previousStatus`) vs 현재 분석(`currentStatus`) 비교 확인<br>2. CPU/RAM/Disk 값 변화 확인<br>3. 병목 후보 변화(개선/악화/변화 없음) 확인<br>4. "다시 분석" 클릭 | `GET /api/data?code=...` ("다시 분석" 클릭 시 `currentStatus`만 재조회해 갱신. `previousStatus`는 화면③ 진입 시점 값을 그대로 유지 — 서버 저장 없음, 클라이언트 state로만 보관) | `previousStatus`가 없는 상태(화면②를 거치지 않고 직접 접근하거나, 새로고침으로 클라이언트 state가 사라진 경우) — 이 경우 비교 화면 자체를 보여줄 수 없다 | `fetch-failed` 등 재조회 실패, `currentStatus`가 아직 조치 전과 사실상 같은 값(Agent가 새 값을 아직 안 올린 경우 — 아래 Holes 참고) |

## A. Orphan endpoints

- **`POST /api/data`** — 화면 ①②③ 어디에서도 호출하지 않는다. 실제
  호출자는 웹이 아니라 `agent/main.py`(Windows Agent 프로세스)다.
  웹 화면 관점에서는 "대응 화면 없는 API"가 맞지만, 시스템 전체로
  보면 정상적으로 쓰이고 있는 endpoint다 — 삭제 대상이 아니라
  "웹이 직접 호출하지 않는 endpoint"로만 기록해둔다.

## B. Holes

1. **"지금 해볼 것" 조치 제안 데이터/로직 없음** — 화면 ②가 요구하는
   기능이지만, `lib/comprehensive-diagnosis.ts`의 `CandidateDetail`,
   Agent의 `build_measurement_value` payload 어디에도 조치 문구 관련
   필드가 없다. 병목 후보 유형(CPU/RAM/Disk × 어떤 조건)을 안전한
   조치 문구에 매핑하는 로직 자체를 새로 만들어야 한다. 기존
   `specs/cpu-overload.md`/`ram-analysis.md`/`disk-analysis.md`/
   `comprehensive-diagnosis.md`는 전부 "해결 방법 제시하지 않음"을
   명시적으로 범위 밖에 뒀던 것이므로, 이번 결정은 그 범위를 다시
   여는 것임을 SPEC 차원에서도 분명히 해야 한다.

2. **화면① "연결 상태"를 자동으로 갱신하는 로직 없음** — `GET
   /api/data`가 `no-data` 여부는 이미 알려주므로 새 endpoint는 필요
   없지만, 화면①이 "코드를 입력하고 기다리면 자동으로 연결됨으로
   바뀐다"를 만족하려면 주기적 재조회(폴링) 로직이 필요하다. 지금은
   버튼을 눌러야만 1회 조회되는 구조뿐이다.

3. **"다시 분석"이 실제로 새 측정값인지 보장할 방법이 없음** —
   `agent/main.py` 루프 주기(실측 약 2.6~4.9초)와
   `HISTORY_WINDOW_SECONDS=60.0`, 그리고 한 번 확정된
   `bottleneck-candidate`는 그 근거 구간이 60초 이력 창 안에 남아있는
   동안 상태가 유지되는 기존 설계(SESSION.md에 이미 기록됨) 때문에,
   조치 직후 곧바로 "다시 분석"을 누르면 `currentStatus`가 아직
   "조치 전"과 사실상 같은 값이거나 같은 병목 후보를 유지한 채로
   돌아올 수 있다. 화면③이 이 상황을 "악화도 개선도 아님"으로
   오해 없이 보여주려면, 최소한 `measuredAt`이 `previousStatus`보다
   실제로 얼마나 최신인지 정도는 함께 판단해야 한다 — 지금은 이걸
   구분할 로직이 없다.

4. **(Hole이 아니라 설계상 감수하는 제약으로 별도 기록)**
   `previousStatus`를 서버가 아니라 클라이언트 state로만 보관하기로
   했으므로, 새로고침하거나 다른 기기/탭에서 접속하면 비교 기준이
   되는 `previousStatus`가 사라진다. 이는 "이번 MVP에서 서버 이력
   저장을 만들지 않는다"는 이번 결정에 따른 의도된 트레이드오프이며,
   화면③의 "빈 상태"로 이미 표에 반영해뒀다.

## C. 오늘 실제 데이터에 연결할 핵심 화면 3개

1. **① 시작 / Agent 연결** — 이미 `POST /api/code`, `GET /api/data`로
   완전히 동작한다. 실제 데이터 연결에는 변경이 필요 없다.
2. **② 성능 분석 결과** — 종합 진단/CPU/RAM/Disk 상세는 이미 실제
   Agent 데이터로 동작한다(`GET /api/data`). "지금 해볼 것" 조치
   제안만 새 로직(Hole 1)이 필요하고, 그 외에는 오늘 바로 실제
   데이터에 연결 가능하다.
3. **③ 조치 전후 비교** — `GET /api/data` 재호출 + 클라이언트 state
   비교라는 방식 자체는 서버 변경 없이 오늘 바로 실제 데이터로 연결
   가능하다. 다만 Hole 3(측정 신선도 판단)을 어떻게 다룰지는 구현
   전에 결정이 필요하다.

## D. 이번 MVP에서 만들지 않는 것

- 분석 기록 화면(여러 번의 분석을 목록/타임라인으로 남기는 화면)
- 연속 모니터링(자동 폴링으로 실시간 추이를 계속 보여주는 화면)
- 서버 쪽 스냅샷 이력 저장(비교는 클라이언트 state로만 처리)
- "지금 해볼 것" 조치의 자동 실행(프로세스 종료/파일 삭제/설정
  변경 자동화) — 어디까지나 "제안" 표시까지만
- 로그인/회원가입, 여러 code/여러 PC에 걸친 기록 관리
