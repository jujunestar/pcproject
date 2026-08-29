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

### 6. 최종 수동 검증 완료 (사용자 직접 실제 Windows 테스트)

이번 세션 마지막에, 사용자가 실제 Windows PC에서 직접 CPU 부하를
발생시켜 수동으로 최종 검증했고 **모두 성공**했다.

- 실제로 CPU 부하를 발생시킴.
- Agent 콘솔에서 `CPU 과부하 후보`로 정상 판정됨.
- 판정 근거(지속시간 등)가 정상적으로 출력됨.
- 관련 프로세스 후보로 **실제 `powershell.exe`**가 정상 탐지됨
  (System Idle Process 오탐 문제가 실사용 환경에서도 해결됐음을
  확인).
- production 웹 [성능 분석] 화면에서도 `CPU 과부하 후보` / CPU
  사용률 / 판정 근거 / 측정 시각 / 관련 프로세스 후보가 **모두
  정상 표시됨**을 확인.

이로써 이전까지 "사용자가 직접 재확인해야 한다"로 남겨뒀던 항목이
모두 실제 검증 완료로 종결됐다.

### 7. RAM + Disk 성능 분석 vertical slice (commit `60a7aab`)

CPU 최종 수동 검증 완료 직후, 같은 날 이어서 `PLAN.md`의 다음
슬라이스인 RAM + Disk 성능 분석을 SPEC → TDD → 구현 → exe 재빌드 →
production 배포까지 완료했다.

- `specs/ram-analysis.md`, `specs/disk-analysis.md`: 이 저장소
  환경에서 실제 psutil 7.2.2를 직접 실행해 확인한 값
  (`virtual_memory`, `disk_usage`, `disk_io_counters` 등)을 근거로
  판정 기준과 한계를 기록. Disk는 "용량 사용률"과 "I/O 성능
  병목"을 코드 구조상 완전히 분리했다(용량만으로 성능 병목을
  단정하지 않음). Windows에는 `disk_io_counters()`에 `busy_time`
  필드가 없음을 확인해, `read_time`+`write_time` 델타를 경과시간으로
  나눈 "활성 시간 비율(%)"을 직접 계산하는 방식을 채택했다(100%를
  넘을 수 있음을 SPEC에 명시).
- `agent/ram_agent.py`, `agent/disk_agent.py`: CPU와 동일한 구조
  (이력 → 지속시간 기반 판정 → 병목 확정 시점에만 프로세스 후보
  수집)로 TDD 구현. `agent/cpu_agent.py`는 이번 슬라이스에서 전혀
  수정하지 않았다.
- `agent/performance_upload.py`: CPU/RAM/Disk 측정 결과를 하나의
  `/api/data` payload로 합쳐 한 번만 업로드하는 순수 함수 (같은
  code에 여러 번 쓰면 이전 값이 덮어써지므로, 반드시 한 번에
  합쳐서 보내야 함).
- `agent/main.py`: RAM/Disk 기본 측정(`virtual_memory`,
  `disk_usage`, `disk_io_counters` 델타)은 핵심 루프에 가볍게
  추가했고, 프로세스 후보 수집(전체 프로세스 순회)은 CPU와 마찬가지로
  병목이 **새로** 확정된 주기에만 실행하도록 설계했다 — 5번 항목에서
  겪은 "프로세스 수집이 판정용 측정 간격 자체를 오염시키는" 문제를
  RAM/Disk에서 반복하지 않기 위함이다. Disk I/O 활성 시간 비율은
  기존 CPU 측정의 2초 블로킹 구간을 그대로 샘플링 창으로 재사용해
  별도 sleep을 추가하지 않았다.
- `lib/performance-status.ts`: `/api/data` 응답을 CPU/RAM/Disk로
  해석하는 신규 모듈. `lib/cpu-status.ts`는 수정하지 않고 타입만
  재사용했다. RAM/Disk 필드가 아예 없는 구버전 Agent payload도
  하위 호환으로 처리(해당 리소스를 `null`로 표시, 임의 값 생성 안 함).
- `app/page.tsx`: `[성능 분석]` 결과 화면에 CPU/RAM/Disk 3개 섹션을
  구분해 표시하도록 변경. 데이터가 부족하면 억지로 정상/병목 판정을
  하지 않고 "데이터 부족"으로 표시.

**검증 결과**:
- Python 전체 123/123 통과 (CPU 47 + RAM 32 + Disk 34 +
  performance_upload 10). `agent/test_cpu_agent.py` 단독 47/47 —
  CPU 회귀 없음.
- npm test 28/28 통과 (cpu-status 13 + performance-status 15).
  typecheck 통과, `next build` 성공.
- 새 exe를 이 PC에서 실제로 실행해, 진짜 psutil 측정값(RAM/Disk
  포함)이 production `/api/data`에 정상 업로드되는 것을 확인.
- exe 재빌드 → `public/downloads/TracePCAgent.exe` 교체 →
  commit(`60a7aab`) → push → Vercel production 자동 배포 완료.
  production에서 실제로 다운로드한 exe와 로컬 빌드 exe의 SHA256이
  `2907ddd0f3efe502d75e12866911b84bdd58481de6d2ebd45a66c83ada2cebc7`
  (12,116,698 bytes)로 완전히 일치함을 확인.
- production API E2E: 코드 발급 → CPU(정상) + RAM(`bottleneck-candidate`,
  evidence/topProcess 포함) + Disk(`bottleneck-candidate`,
  `diskActivePercent: 175.0`처럼 100% 초과값 포함) 통합 payload를
  POST → GET으로 원본과 완전히 동일하게 왕복됨을 확인.

**이번 세션에서 자동으로 검증하지 못하고 남겨둔 것**: CPU 슬라이스
때와 마찬가지로, 위험한 실제 RAM 고갈이나 Disk 풀가동 부하는 이번
세션에서 직접 만들지 않았다. production API 왕복은 인위적으로 구성한
payload로 검증했을 뿐, 실제 RAM/Disk 부하에서 Agent 콘솔과 웹 화면에
`bottleneck-candidate` 전환·판정 근거·관련 프로세스 후보가 실제로
표시되는지는 아직 실측 확인되지 않았다.

### 8. RAM 실제 Windows 수동 검증 완료 (사용자 직접 실제 Windows 테스트)

이어서, 사용자가 실제 Windows PC에서 production
`TracePCAgent.exe`를 사용해 안전하게 설계된 점진적 메모리 할당
스크립트로 RAM 부하를 직접 발생시켜 수동으로 검증했고 **모두
성공**했다. 위험한 RAM 고갈 없이 안전 여유(여유 메모리 하한선)를
남긴 상태로 테스트했고, 테스트 종료 후 메모리도 정상 반환됐다.

- production 웹 `[성능 분석]` 화면에서 확인된 값:
  - RAM 사용률: 93.9%
  - 사용 중 메모리: 14.8GB
  - 사용 가능한 메모리: 1.0GB
  - 상태: `RAM 병목 후보`
  - 판정 근거: 최고 94.0%, 11:59:44 ~ 11:59:50, 6.0초 지속
    (`MIN_SUSTAINED_SECONDS=5.0` 기준을 실측으로 충족)
  - RAM 사용량이 높은 프로세스 후보: `powershell.exe`
    (PID 5336, 7007.3MB) — 실제 부하를 발생시킨 프로세스가 그대로
    정상 탐지됨.
- 같은 상황에서 CPU/Disk 섹션도 정상 표시되어, RAM 검증 과정에서
  기존 CPU 회귀나 Disk 표시 깨짐이 없음을 함께 확인했다.

이로써 RAM 성능 분석은 자동 검증에 이어 실제 Windows 수동 검증까지
**완료**됐다. Disk 성능 분석의 실제 Windows I/O 부하 수동 검증만
아직 남아 있다.

### 9. Disk 실제 Windows I/O 수동 검증: 미재현 (자동 검증은 완료 상태 유지)

이어서 Disk 실제 Windows I/O 부하 수동 검증을 시도했으나, 안전한 범위
안에서는 `bottleneck-candidate`(활성 시간 90% 이상 5초 이상 지속)를
**재현하지 못했다**. 이 결과를 버그로 단정하지 않고, 아래 근거와 함께
"미재현" 상태로 기록한다.

**시도한 부하 방식 (총 2단계, 매번 안전 조건 — 시스템/사용자 파일
미접촉, `%TEMP%` 하위 임시 파일만 사용, 시간/용량/반복 횟수 상한,
무한 루프 없음, 종료 후 삭제 확인 — 을 지킨 채 진행)**:

1. 작은 파일(50KB × 200개) 반복 복사/삭제 (`Copy-Item`, 병렬 3개
   작업, 각 최대 15초/60회).
2. `System.IO.FileStream`을 `FileOptions.WriteThrough`로 열어 OS
   쓰기 캐시를 우회하는 순차 쓰기 (8MB 청크, 병렬 4개 작업, 각 최대
   20초/2GB/400회 중 먼저 도달하는 조건까지).

**관찰 방법 (코드 수정 없음)**: 두 단계 모두, `agent/disk_agent.py`의
`compute_disk_active_percent`를 그대로 import해 Agent와 동일한 공식으로
1.5초 간격 실시간 출력하는 관찰용 스크립트(프로젝트 파일 아님,
스크래치패드에만 존재)와, psutil과 무관한 Windows 자체
`typeperf "\PhysicalDisk(_Total)\% Disk Time"` 카운터를 **동시에**
띄워 서로 대조했다.

**결과**:
- 1단계(Copy-Item): Agent 계산값 약 0~0.3%, typeperf 약 0~5%.
- 2단계(WriteThrough): production 웹에서도 여전히 Disk I/O
  병목 후보로 전환되지 않음.
- production 웹 최종 확인값: Disk 용량 사용률 53.8%, Disk I/O 상태
  "병목 근거 없음", Disk 활성 시간 0.0%.
- 같은 테스트 동안 CPU/RAM 섹션과 웹/API 전반은 정상 동작을 유지했다
  (회귀 없음).

**판단**: 서로 독립적인 두 측정 경로(Agent의 계산식 자체 재사용 관찰값,
Windows 자체 typeperf 카운터)가 두 단계 모두에서 일관되게 낮은 값으로
**서로 일치**했다. 이는 "판정 로직이 잘못 계산한다"는 가설과 배치되는
근거이며, 오히려 이 PC의 특정 NVMe SSD가 이번 세션에서 시도한 안전한
범위의 부하로는 물리적으로 포화(saturate)되지 않았을 가능성을
시사한다. 다만 이것도 확정된 원인은 아니며, 근거가 부족한 채로
단정하지 않는다.

**결정**: 이 이상으로 SSD에 더 강한 부하를 거는 시도는 더 이상 하지
않는다(사용자 결정). Disk I/O 병목 판정 로직은 automated tests
(pytest 34개)와 production API E2E(인위적으로 구성한
`bottleneck-candidate` payload로 POST→GET 왕복 검증, `60a7aab`
커밋 시점에 완료)에서 이미 정상 동작이 확인된 상태이므로 그 자동
검증 완료 상태는 그대로 유지한다. **최종 상태: "Disk 실제 Windows
I/O 병목 수동 검증: 미재현 / 자동 검증 완료".**

### 10. CPU/RAM/Disk 종합 진단 vertical slice + 실제 production 수동 확인 완료

Disk 미재현 결론을 낸 직후, 같은 세션에서 이어서 "CPU/RAM/Disk 종합
진단" 슬라이스를 브레인스토밍(설계 승인) → `specs/comprehensive-diagnosis.md`
→ TDD → 구현 → 전체 회귀 테스트 → typecheck/build → deploy →
production API E2E까지 중간 승인 없이 진행했고, 그 직후 사용자가
실제 production 웹에서 직접 확인해 정상 동작을 확인했다.

- 새 파일 `lib/comprehensive-diagnosis.ts`(순수 함수) +
  `lib/comprehensive-diagnosis.test.ts`(10개 테스트)만 추가했고,
  `agent/*.py`와 기존 CPU/RAM/Disk 개별 판정 로직·상세 섹션은 전혀
  건드리지 않았다.
- 순위 규칙: 2개 이상 동시 후보일 때 유일하게 세 리소스가 공유하는
  실측 공통 단위인 `durationSeconds`로만 순위를 매기고(퍼센트끼리는
  절대 비교하지 않음), 최댓값이 완전히 동률이면 임의의 승자를 만들지
  않고 그 시점의 후보 전체를 "동시에 감지된 병목 후보"로 표시한다.
- `npm test` 38/38, `npm run typecheck`/`npm run build` 통과,
  `python -m pytest`(agent) 123/123로 Agent 무회귀 재확인.
- production 배포 JS 번들에서 새 코드 시그니처(`single-primary`,
  `tied-primary`, "가장 의심되는", "동시에 감지된") 존재를 직접
  확인했고, RAM/Disk가 동률(6.0초)인 합성 payload로 production
  `/api/data` POST→GET 왕복도 확인했다.
- commit `dec46b6`(Disk 미재현 기록), `0727f29`(종합 진단 기능).
- **이어서 사용자가 실제 production 웹에서 연결 코드로 직접
  `[성능 분석]`을 눌러 화면을 확인**했고, 종합 진단 요약 카드와
  기존 CPU/RAM/Disk 상세 섹션이 함께 정상적으로 표시됨을 확인했다
  ("다 보여"). 이로써 자동 검증만으로 남아 있던 마지막 항목(실제
  브라우저 렌더링 확인)까지 완료됐다.

이로써 CPU/RAM/Disk 개별 분석 + 종합 진단까지, 이번 2주 MVP 범위의
핵심 vertical slice가 모두 완료 상태가 됐다.

## 현재 상태 (production 기준)

- **CPU 성능 분석**: `PLAN.md` 기능 1~3이 production에 배포돼 있고,
  실제 Windows 환경의 수동 부하 테스트로 end-to-end 최종 검증까지
  완료됐다(위 6번 항목). **완료 상태.** 회귀 버그가 확인되지 않는 한
  `agent/cpu_agent.py`, `agent/main.py`의 CPU 관련 부분,
  `lib/cpu-status.ts`, `app/page.tsx`의 CPU 관련 부분을 임의로
  수정하지 않는다.
- **RAM 성능 분석**: commit `60a7aab`로 구현·production 배포까지
  완료된 데 이어, 위 8번 항목에서 실제 Windows 수동 부하 검증까지
  마쳤다. **완료 상태.** 회귀 버그가 확인되지 않는 한
  `agent/ram_agent.py`, `agent/main.py`의 RAM 관련 부분,
  `lib/performance-status.ts`, `app/page.tsx`의 RAM 관련 부분을
  임의로 수정하지 않는다.
- **Disk 성능 분석**: commit `60a7aab`로 구현·production 배포까지
  완료됐고, 자동으로 검증 가능한 범위(테스트, typecheck, build, exe
  해시 일치, production API E2E, CPU/RAM 회귀 없음)는 모두 통과했다.
  위 9번 항목에서 실제 Windows I/O 부하 수동 검증을 시도했으나
  안전한 범위 안에서는 재현하지 못했다. **최종 상태: "Disk 실제
  Windows I/O 병목 수동 검증: 미재현 / 자동 검증 완료".** 이를
  버그로 단정하지 않으며, 더 강한 SSD 부하 테스트는 더 이상
  시도하지 않는다. 회귀 버그가 확인되지 않는 한
  `agent/disk_agent.py`, `agent/performance_upload.py`,
  `agent/main.py`의 Disk 관련 부분, `lib/performance-status.ts`,
  `app/page.tsx`의 Disk 관련 부분을 임의로 추가 수정하지 않는다.
- **CPU/RAM/Disk 종합 진단**: commit `0727f29`로 구현·production
  배포까지 완료됐고, 위 10번 항목에서 실제 production 웹 화면으로
  사용자가 직접 확인까지 마쳤다. **완료 상태.** 회귀 버그가 확인되지
  않는 한 `lib/comprehensive-diagnosis.ts`와 `app/page.tsx`의 종합
  진단 관련 부분을 임의로 수정하지 않는다.

## 다음 세션 Next Step

CPU/RAM/Disk 개별 분석 + 종합 진단까지 전부 완료 상태이며, 자동
검증과 실제 production 수동 확인을 모두 마쳤다. 회귀 버그가 없는 한
기존 구현을 임의로 수정하지 않는다. 다음으로 무엇을 할지(최종 UI
디자인/스타일링, 새 기능, 배포 마무리 등)는 아직 정해지지 않았다 —
다음 세션은 사용자에게 우선순위를 먼저 확인하는 것부터 시작한다.
