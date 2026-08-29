# SESSION — 2026-08-29

## 오늘 완료한 상태

### 1~3. CPU 성능 분석 vertical slice (커밋 `61e169a`)

`PLAN.md` 기능 3(CPU 과부하 원인 후보 + 관련 프로세스 + 측정 근거)을
SPEC → TDD → 구현 → exe 재빌드 → production 배포까지 완료.

### 4. 1차 버그 수정: 실제 부하에서도 데이터 부족만 뜨던 문제 (커밋 `0d58cf3`)

실제 `main.py`를 부하 없이 실행해 외부에서 실측한 결과, 프로세스 후보
프라이밍 + 업로드 왕복 때문에 측정 간격이 부하 없이도 2.7~4.6초까지
벌어져 있었고, `MAX_SAMPLE_GAP_SECONDS=4.0`이 그보다 좁아 구간이
계속 끊김을 확인. `10.0`으로 수정, 실측 간격 기반 회귀 테스트 추가.

### 5. 2차 버그 수정: 실제 production 100% 부하에서도 여전히 데이터
부족만 뜨던 문제 + topProcess 신뢰성 문제

**증상**: 1차 수정 반영 후에도, 사용자가 production에서 실제로 CPU
100%를 여러 번 연속 측정했는데 Agent 콘솔과 웹 모두 계속
`데이터 부족`을 유지.

**디버깅**: 코드 수정 없이 결론 내리지 않고, 실제 `agent/main.py`와
동일한 로직을 그대로 따라가는 안전한 재현 스크립트를 작성했다 —
`psutil.cpu_percent`만 "항상 100.0을 반환하되 실제 psutil처럼 2초
블로킹"하도록 감시(monkeypatch)해서, **위험한 실제 CPU 부하를
만들지 않고도** 실제 프로세스 전수 프라이밍 오버헤드·실제 production
업로드 왕복 시간까지 포함한 진짜 루프 타이밍으로 "CPU 100%가 여러 번
연속 측정된 상황"을 재현했다. 매 반복마다 요청받은 모든 값(측정
timestamp, cpuPercent, history 길이, trim 전/후 history,
evaluate_overload_status 입력/출력, 각 구간 사이 gap과 어느 지점에서
끊겼는지)을 출력했다.

**확인된 사실**:
- `evaluate_overload_status` 자체 로직과 `MAX_SAMPLE_GAP_SECONDS=10.0`은
  현실적인 간격(3.7~4.9초)에서 정상적으로 3번째 샘플 만에
  `overload-candidate`를 반환함 — 판정 로직 자체는 문제가 없었다.
- `history`는 루프마다 정상적으로 누적되고 있었고(초기화/리셋 없음),
  `trim_history`도 과도하게 지우지 않았으며, wall-clock/monotonic
  혼용도 없었다.
- **진짜 남은 문제는 설계 자체**: 프로세스 후보 프라이밍
  (`for proc in processes: proc.cpu_percent(None)`)이 **매 루프
  주기마다 무조건** 실행되고 있었다 — 과부하 여부와 무관하게. 이
  프라이밍은 실측 약 0.4~0.9초가 걸리는데, 이 비용이 "과부하 판정에
  직접 쓰이는" `measured_at` 간격 자체에 매번 끼어들고 있었다.
  실제 100% 부하 상황에서는 OS 스케줄러 경합으로 이 프라이밍
  syscall들이 훨씬 느려질 수 있는데, 하필 그 비용이 판정이 가장
  정확해야 하는 바로 그 구간(고CPU 지속 여부를 확인하는 구간)의
  타이밍을 매번 갉아먹는 구조였다. 즉 "감지하려는 상황(고부하) 자체가
  감지 도구의 정확도를 떨어뜨리는" 자기파괴적 설계였다.
- **추가로 발견한 별도 버그**: `pick_top_process`가 필터링 없이
  `cpuPercent`가 가장 높은 프로세스를 그대로 골랐는데, Windows의
  `System Idle Process`(PID 0)는 psutil이 코어 수에 비례해 수백 %까지
  보고할 수 있어(유휴 시간을 나타내는 값일 뿐 실제 작업이 아님)
  거의 항상 "1위"로 뽑혀버렸다. 실제 재현 스크립트 업로드 결과
  `topProcess: {"pid": 0, "name": "System Idle Process", "cpuPercent": 686.4}`
  로 production Redis에 그대로 저장되는 것을 확인 — 원인 후보로 절대
  제시돼서는 안 되는 값이 표시되는 명백한 버그였다.

**수정** (상수를 더 늘리지 않고, 실제 원인인 설계를 고침):
- `agent/main.py`: 프로세스 프라이밍/수집을 **매 루프에서 분리**했다.
  이제 핵심 측정 루프(시스템 CPU 측정 → history → 판정 → 업로드)는
  프로세스 관련 작업을 전혀 하지 않는다. 프로세스 후보 수집은
  `evaluate_overload_status`가 **새로운** `overload-candidate` 구간을
  막 확정한 바로 그 주기에만, 그것도 한 번만 실행된다(같은 구간에
  대해 반복 수집하지 않음 — `last_evidence_started_at`으로 추적).
  이로써 프로세스 수집 비용이 판정에 쓰이는 측정 간격을 절대
  오염시킬 수 없다.
- `agent/cpu_agent.py`:
  - `should_collect_process_samples(overload_result, last_evidence_started_at)`
    신규 추가 — 위 "언제 수집할지" 결정을 순수 함수로 분리해 TDD.
  - `pick_top_process`가 `SYSTEM_IDLE_PROCESS_PID(=0)`를 후보에서
    항상 제외하도록 수정.
- `agent/test_cpu_agent.py`: 회귀 테스트 추가
  (`test_pick_top_process_excludes_system_idle_process_even_if_highest`,
  `test_pick_top_process_returns_none_when_only_system_idle_process`,
  `should_collect_process_samples`용 5개 테스트).

**검증**:
- 수정 전/후 모두 안전한 재현 스크립트(실제 psutil 부하 없이, 실제
  main.py 로직 그대로)로 비교. 수정 후: 빌드업 구간 간격이
  2.6~2.8초로 훨씬 촘촘해졌고(수정 전 3.7~4.9초), 3번째 샘플 만에
  `overload-candidate` 확정, `topProcess`는 실제 프로세스
  (`python.exe`, 재현 스크립트 자기 자신)로 정상 표시됨을 확인.
  production `/api/data`에서도 동일하게 확인
  (`overloadStatus: "overload-candidate"`, `overloadEvidence` 채워짐,
  `topProcess`가 더 이상 System Idle Process가 아님).
- `python -m pytest`: 47개 전체 통과.
- `npm test`(13개) / `npm run typecheck` / `npm run build` 모두 통과.
- exe 재빌드 → `public/downloads/TracePCAgent.exe` 교체.
  - 새 exe SHA256: `8dd0007d9f4e94552901e34aa498ec5e836ae528626805486f84a598df33859c`
  - 크기: 12,103,500 bytes
- 새 exe를 로컬에서 실제로 실행해 정상 경로(실제 ambient CPU,
  `overloadStatus: "normal"`) 재확인.
- commit / push 완료, Vercel production 재배포, production에서
  다운로드한 exe 크기가 새 빌드와 일치함을 확인.

**production에서 여전히 직접 확인이 필요한 것**: 이번에도 위험한
실제 CPU 100% 부하는 직접 만들지 않았다. `overload-candidate` 경로와
`topProcess` 신뢰성은 (a) 실제 main.py 로직을 그대로 따라가되
CPU 퍼센트만 안전하게 흉내낸 재현 스크립트로 production API까지
포함해 검증했고, (b) 정상 경로는 새 exe로 실측 검증했다. 실제
사용자의 CPU 100% 부하 상황에서 웹 화면에 "CPU 과부하 후보 + CPU
사용률 + 지속시간 근거 + 측정 시각 + 관련 프로세스 후보(이름/PID/
CPU%)"가 모두 함께 표시되는지는 사용자가 직접 재확인해야 한다.

## 현재 상태 (production 기준)

`PLAN.md` 기능 1~3이 production에 배포돼 있고, 이번 세션에서 발견된
두 차례의 실제 부하 관련 버그(측정 간격 임계값, 프로세스 수집 설계,
System Idle Process 오염)를 모두 수정해 반영했다. 다만
`overload-candidate` 상태의 실제 화면 표시는 아직 사용자의 직접적인
실제 부하 테스트로 최종 확인되지 않았다.

## 다음 세션 Next Step

1. 사용자가 실제로 CPU 90%+/5초 이상 부하를 걸어, 웹 [성능 분석]
   화면에 `CPU 과부하 후보` + CPU 사용률 + 지속시간 근거 + 측정
   시각 + 관련 프로세스 후보(이름/PID/CPU%)가 모두 함께 표시되는지
   최종 확인 — 이 확인 전까지는 RAM/Disk 등 다음 기능을 시작하지
   않는다.
2. 확인되면 RAM / Disk 분석, 최종 UI 디자인 등 다음 범위 논의.
