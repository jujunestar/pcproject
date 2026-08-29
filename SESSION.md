# SESSION — 2026-08-29

## 오늘 완료한 상태

### 1~3. CPU 성능 분석 vertical slice (SESSION 앞부분, 커밋 `61e169a`)

`PLAN.md` 기능 3(CPU 과부하 원인 후보 + 관련 프로세스 + 측정 근거)을
SPEC → TDD → 구현 → exe 재빌드 → production 배포까지 완료했다.

- `specs/cpu-overload.md` 구현: `agent/cpu_agent.py`에
  `evaluate_overload_status`/`trim_history`/`format_overload_status_line`.
- `specs/cpu-process-candidates.md` 신규 작성 및 구현:
  `collect_process_samples`/`pick_top_process`, 과부하 후보 주기에만
  프로세스 후보 수집.
- 웹 `/api/data` payload에 `overloadStatus`/`overloadEvidence`/
  `topProcess` 추가, `lib/cpu-status.ts` 파싱 확장,
  `app/page.tsx` 5단계를 "성능 분석"으로 변경.

### 4. **버그 발견 및 수정: 실제 부하 상황에서 CPU 과부하 후보가 뜨지 않음**

**증상**: 사용자가 production에서 실제로 CPU를 90% 이상으로 5초 넘게
유지했는데도 웹의 [성능 분석]이 계속 `CPU 과부하 근거 없음`/
`데이터 부족`만 표시하고 `CPU 과부하 후보`로 바뀌지 않음을 보고.

**디버깅 과정** (자동 테스트 통과만으로 정상 판단하지 않고 실제 경로
추적):
- 코드 수정 없이 `agent/main.py`를 실제로 실행하며 각 콘솔 출력 줄의
  도착 시각을 외부에서 타임스탬프로 기록 → 연속된 CPU 측정
  (`measured_at`) 사이의 실제 간격이 이상적인 2.0초가 아니라
  **2.7~4.6초**까지 벌어짐을 실측으로 확인 (부하가 전혀 없는
  상태에서도).
- 그 간격의 출처를 분리 측정: 매 주기 프로세스 후보 수집을 위한
  프로세스 전수 프라이밍(`for proc in processes: proc.cpu_percent(None)`,
  276개 프로세스 기준 약 0.44~0.55초)과 production 업로드 HTTP
  왕복(약 0.65~0.93초)이 psutil의 2.0초 블로킹 측정 위에 추가로
  더해지는 것을 확인.
- 그 실측 간격을 그대로 `evaluate_overload_status`에 넣어보면(코드
  수정 전) 95% 4개 연속 샘플임에도 `insufficient-data`가 반환됨을
  재현 — `MAX_SAMPLE_GAP_SECONDS=4.0`이 실제 측정 간격보다 좁아서
  4.553초짜리 정상적인 주기 지연조차 "공백"으로 취급해 구간을
  끊어버리고 있었음.

**정확한 원인**: `specs/cpu-overload.md`가 `MAX_SAMPLE_GAP_SECONDS`를
"`MEASURE_INTERVAL_SECONDS(2.0초)`의 2배 = 4.0초"로 고정했는데, 이는
"매 측정 주기가 약 2초"라는 가정에 의존한다. 이번 세션 앞부분에서
고CPU 프로세스 후보 수집 기능을 추가하며 `agent/main.py`의 매 주기에
전체 프로세스 프라이밍과 (원래도 있던) 네트워크 업로드가 더해졌고,
그 결과 실제 주기가 2.7~4.6초로 늘어나 `MAX_SAMPLE_GAP_SECONDS(4.0)`를
일상적으로 초과하게 됐다. 90%+ CPU가 실제로 몇 초씩 지속되더라도,
매 정상 주기의 간격 자체가 "공백"으로 오판되어 구간이 계속 끊기므로
5초 지속 조건에 도달할 수 없었다 — 즉 실전에서 `overload-candidate`
분기가 사실상 도달 불가능했다.

**왜 자동 테스트에서 잡히지 않았는가**: `evaluate_overload_status`의
기존 39개 테스트는 모두 손으로 만든 "이상적으로 정확히 몇 초씩
떨어진" 타임스탬프(0/2/4/6초 등)만 사용했다. 순수 함수 자체의 판정
로직(임계값·지속시간·공백 규칙)은 정확히 구현돼 있었으므로 그
테스트들은 모두 통과했지만, **`agent/main.py`가 실제로 만들어내는
`measured_at` 간격이 그 가정과 얼마나 다른지는 어떤 자동 테스트도
검증하지 않았다.** 즉 버그는 순수 함수 안이 아니라 "순수 함수가
가정한 입력 분포"와 "실제 프로그램이 만드는 입력 분포"의 불일치에
있었고, 이는 실제 프로그램을 실행해 실측하지 않으면 드러나지 않는
종류였다.

**수정** (최소 수정, 판정 조건 완화가 아닌 잘못된 가정 교정):
- `agent/cpu_agent.py`: `MAX_SAMPLE_GAP_SECONDS`를 `4.0` → `10.0`으로
  수정. 실제 한 주기 길이(약 4~5초)의 2배 수준으로, "한 주기 분량의
  지연은 흡수하되 그 이상은 흡수하지 않는다"는 원래 스펙의 취지를
  실제 측정값 기준으로 다시 맞춘 것이지, 90%/5초라는 판정 기준 자체를
  낮춘 것이 아니다.
- `specs/cpu-overload.md`: `MAX_SAMPLE_GAP_SECONDS` 표에 실측 근거와
  버그 수정 이력을 기록.
- `agent/test_cpu_agent.py`:
  - 회귀 테스트 추가
    (`test_evaluate_overload_status_overload_candidate_with_realistic_agent_loop_gaps`):
    실제 `agent/main.py`를 부하 없이 실행해 외부에서 실측한 간격
    (2.698s / 4.553s / 3.467s)을 그대로 사용해 95% 4개 연속 샘플이
    `overload-candidate`로 판정돼야 함을 검증. 수정 전 코드로 이
    테스트를 실행하면 실패함을 먼저 확인(RED)한 뒤 상수를 고쳐
    통과(GREEN)시켰다.
  - 기존 공백 경계 테스트 2개를 `MAX_SAMPLE_GAP_SECONDS` 상수를
    직접 참조하도록 수정해, 상수가 다시 바뀌어도 경계 테스트가
    자동으로 그 값을 따라가도록 함.

**검증**
- `python -m pytest`: 40개 전체 통과 (회귀 테스트 포함).
- `npm test`(13개) / `npm run typecheck` / `npm run build` 모두 통과
  (웹 코드는 이번 수정과 무관, 회귀 없음 재확인).
- exe 재빌드(`pyinstaller ... agent/main.py`) →
  `public/downloads/TracePCAgent.exe` 교체 → 로컬에서 새 exe를
  직접 실행해 정상 상태 payload가 여전히 production에 정상
  업로드됨을 확인.
- commit / push 완료, Vercel production 재배포.

**production에서 확인해야 할 것 (사용자가 직접 실제 부하 테스트로
검증)**: 연결 코드로 Agent를 실행한 뒤 CPU를 90% 이상으로 5초 이상
유지하면서,
1. Agent 콘솔에 `상태: CPU 과부하 후보 (NN.N%, HH:MM:SS~HH:MM:SS,
   N.N초 지속)` 줄이 실제로 출력되는지,
2. `관련 프로세스 후보: ...` 줄이 함께 출력되는지,
3. 같은 코드로 `GET /api/data`를 조회했을 때 `overloadStatus`가
   `"overload-candidate"`이고 `overloadEvidence`/`topProcess`가
   `null`이 아닌지,
4. 웹 [성능 분석] 화면에 `CPU 과부하 후보`와 판정 근거·관련
   프로세스 후보가 표시되는지.

이번 세션에서는 위험한 인위적 고부하를 자동 생성하지 않았으므로,
`overload-candidate` 경로 자체는 (a) 실제 agent 루프에서 실측한
간격을 그대로 사용한 회귀 테스트와 (b) 정상/데이터 부족 경로의
production 실측으로 검증했고, 실제 90%+ 5초 지속 화면 표시는 다음에
사용자가 직접 부하를 걸어 확인해야 한다.

## 현재 상태 (production 기준)

`PLAN.md` 기능 1~3이 모두 production에 배포돼 있고, 위 버그 수정도
반영된 exe/웹이 배포된 상태다. 다만 `CPU 과부하 후보` 표시 자체는
사용자의 실제 부하 테스트로 아직 육안 재확인되지 않았다.

## 다음 세션 Next Step

1. 사용자가 실제로 CPU 90%+/5초 이상 부하를 걸어 위 "production에서
   확인해야 할 것" 4가지를 직접 확인 — 이 확인 전까지는 RAM/Disk 등
   다음 기능을 시작하지 않는다.
2. 확인되면 RAM / Disk 분석, 최종 UI 디자인 등 다음 범위 논의.
