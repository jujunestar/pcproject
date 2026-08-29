# SPEC — Agent: RAM 병목 후보 분석

## 목표

Agent가 실제 측정한 RAM 사용률 이력을 바탕으로 **데이터 부족 / 정상 /
RAM 병목 후보** 세 상태 중 하나를 판정하고, 병목 후보로 확정된 경우
RAM 사용량이 높은 프로세스 후보(측정된 값 그대로, 추정 없이)를 함께
제시한다.

`specs/cpu-overload.md`와 동일한 구조(이력 → 지속시간 기반 판정 →
병목 확정 시점에만 프로세스 후보 수집)를 그대로 따른다. CPU 슬라이스에서
검증된 설계를 재사용하되, `agent/cpu_agent.py`는 이번 슬라이스에서
전혀 수정하지 않는다(회귀 위험 제거). RAM 전용 로직은
`agent/ram_agent.py`에 독립적으로 구현한다.

## 실제 psutil 측정값 확인 (Windows, psutil 7.2.2, 이 저장소 환경에서 직접 실행해 확인)

```
>>> psutil.virtual_memory()
svmem(total=16948908032, available=6808727552, percent=59.8,
      used=10140180480, free=6808727552)
```

- `total`: 전체 물리 메모리(byte). 실제 값.
- `percent`: `used / total * 100`에 대응하는 값이지만, **Windows에서는
  `used`가 단순 `total - free`가 아니라 `total - available`을 기반으로
  계산된다.** `available`은 "즉시 회수 가능한 standby/캐시 목록"까지
  반영한 값이라, 단순히 파일 캐시가 쌓여 있다고 `percent`가 올라가지
  않는다 (Linux `free` 명령의 순수 `free` 값과는 의미가 다르다). 즉
  Windows에서 `percent`가 높다는 것은 "회수 가능한 캐시"가 아니라
  "실제로 반환하기 어려운 메모리 사용"에 가깝다는 근거가 된다. 이
  판정의 신뢰도를 뒷받침하는 이유로 SPEC에 명시해 둔다.
- `used`: 실제 사용 중 메모리(byte). 실제 값, 화면에 그대로 표시.
- `available`: 실제 사용 가능한 메모리(byte, 회수 가능한 캐시 포함).
  화면에 "사용 가능한 메모리"로 표시.
- `free`는 이번 슬라이스에서 사용하지 않는다(요청 항목 아님 — Windows의
  `free`는 진짜 미사용 페이지만 가리켜 "사용 가능한 메모리" 직관과
  다르므로 혼동을 피한다).

프로세스별로는 다음이 실제로 조회된다.

```
>>> p.memory_info()
pmem(rss=21819392, vms=..., ...)
>>> p.memory_percent()
0.128...  # 전체 RAM 대비 rss 비율(%)
```

- `rss`(Resident Set Size, byte)를 "해당 프로세스가 실제 점유 중인
  물리 메모리"로 사용한다. 근사가 아니라 psutil이 OS에서 직접 읽어오는
  실측값이다.
- `memory_percent()`도 실측값(= `rss / 전체 물리메모리 * 100`)이며 화면
  표시에 함께 쓸 수 있다.

## 이번 슬라이스 완료 조건

1. RAM 병목 판정 순수 함수(`evaluate_ram_status`)를 TDD로 구현한다
   (`agent/ram_agent.py`).
2. RAM 사용량 기준 프로세스 후보 수집 순수 함수
   (`collect_process_memory_samples`, `pick_top_memory_process`)를
   TDD로 구현한다.
3. `agent/main.py`가 매 측정 주기 `psutil.virtual_memory()`를 호출해
   RAM 이력을 메모리에 유지하고, 판정 결과를 콘솔에 출력한다.
4. RAM 병목 후보로 **새로** 확정된 주기에만 프로세스 후보 수집을
   실행한다 (매 주기 무조건 실행 금지 — CPU 슬라이스에서 겪은
   "판정 자체를 오염시키는 무거운 작업" 문제를 반복하지 않는다).
5. `agent/cpu_agent.py`, 기존 CPU 판정/업로드 동작은 전혀 수정하지
   않는다.

## 입력 데이터

- `history`: 시간 순 측정값 목록. 각 항목
  `{ramPercent: number, measuredAt: ISO8601 문자열}`.
- Agent가 실제로 `psutil.virtual_memory()` 측정에 성공한 주기마다만
  이 목록에 추가한다. 측정 실패 주기는 채워 넣지 않는다.
- 판정 함수는 항목 간 간격이 일정하다고 가정하지 않고 `measuredAt`
  실제 차이로만 지속시간을 계산한다 (CPU와 동일 원칙).

## 상수

| 상수 | 값 | 근거 |
|---|---|---|
| `RAM_HIGH_THRESHOLD_PERCENT` | `90.0` | CPU 슬라이스와 동일한 기준선(90%)을 채택한다. 위에서 확인했듯 Windows의 `virtual_memory().percent`는 회수 가능한 캐시를 이미 제외한 값이므로, 90% 이상은 "회수 가능한 캐시로 인한 착시"가 아니라 실제 압박 상태를 뜻한다고 볼 근거가 있다. 다만 이는 여전히 하나의 실용적 기준선이며 절대적 과학적 임계값은 아니다(한계로 명시). |
| `MIN_SUSTAINED_SECONDS` | `5.0` | CPU와 동일한 루프에서 동일한 주기로 측정되므로(같은 `measured_at`), 순간적인 스파이크(예: 짧은 대량 할당 후 즉시 해제)만으로 병목 후보로 단정하지 않기 위해 CPU와 동일한 최소 지속시간을 채택한다. |
| `MAX_SAMPLE_GAP_SECONDS` | `10.0` | RAM 이력은 CPU 이력과 **같은 루프 주기**(같은 `measured_at`)에서 채워지므로, `specs/cpu-overload.md`에서 실측으로 확정한 루프 간격 한계(약 4~5초, 넉넉히 2배인 10.0초)를 그대로 채택한다. 별도로 다시 실측하지 않고 "같은 루프이므로 같은 근거가 적용된다"는 점을 SPEC에 명시한다. |
| `HISTORY_WINDOW_SECONDS` | `60.0` | CPU와 동일. `main.py`의 이력 보관 정책. |

## 판정 로직

`specs/cpu-overload.md`의 판정 로직과 완전히 동일한 구조를
`ramPercent` / `RAM_HIGH_THRESHOLD_PERCENT`에 대해 적용한다.

1. `ramPercent`가 숫자가 아니거나 `measuredAt`을 파싱할 수 없는 항목은
   제외한다.
2. 유효 항목이 2개 미만이면 → **데이터 부족**.
3. `ramPercent >= 90.0`이고 이전 항목과의 시간차가
   `<= MAX_SAMPLE_GAP_SECONDS`인 연속 구간(run)을 찾는다.
4. 지속시간(`>= MIN_SUSTAINED_SECONDS`)을 만족하는 구간이 있으면 →
   **RAM 병목 후보** (근거: 시작/종료 시각, 지속시간, 구간 내 최고
   `ramPercent`).
5. 아니면 마지막 항목을 본다: `>= 90.0`이면 아직 지속 여부를 알 수
   없으므로 **데이터 부족**, `< 90.0`이면 **정상**.

## 관련 프로세스 후보 선정 방식

- `collect_process_memory_samples(process_iter_fn)`: 각 프로세스에서
  `pid`, `name()`, `memory_info().rss`, `memory_percent()`를 읽어
  `{"pid", "name", "rss", "memoryPercent"}`로 수집한다. 조회 중 예외
  (프로세스 종료, 접근 거부 등)가 발생한 프로세스는 건너뛰고 나머지는
  계속 수집한다 (CPU의 `collect_process_samples`와 동일한 방어 원칙).
- **CPU와 달리 "직전 값 대비 변화율"을 계산할 필요가 없다** — `rss`는
  그 순간의 절대 사용량이므로 한 번의 스냅샷으로 충분하다. 따라서
  CPU처럼 프라이밍 후 대기하는 2단계 과정이 필요 없고, 병목 후보로
  확정된 주기에 프로세스 목록을 한 번 순회하는 것으로 끝난다.
- `pick_top_memory_process(samples)`: `rss`가 가장 큰 프로세스 하나를
  반환한다. 비어 있으면 `None`. 동률이면 먼저 나온 항목.
- **Windows 특수 프로세스 예외**: `SYSTEM_IDLE_PROCESS_PID(=0)`은 CPU
  슬라이스와 동일한 이유로 후보에서 항상 제외한다 — 실제 작업으로
  메모리를 점유하는 프로세스가 아니라 유휴 상태를 나타내는 플레이스홀더이므로,
  포함 시 사용자에게 오해를 줄 수 있다.
- 전체 프로세스 순회는 병목 후보가 **새로** 확정된 주기에만 1회
  실행한다 (`should_collect_ram_process_samples`로 판단 — CPU의
  `should_collect_process_samples`와 동일한 "같은 구간이면 재수집하지
  않음" 원칙).

## 데이터 부족/누락 시 처리

- 이력이 비어 있거나 1개뿐 → 데이터 부족.
- 아직 5초를 채우지 못한 진행 중인 고사용률 구간 → 데이터 부족 (정상도
  병목 후보도 아님).
- 두 측정 사이 간격이 `MAX_SAMPLE_GAP_SECONDS` 초과 → 그 지점에서
  구간을 끊는다.
- `ramPercent` 필드가 없거나 타입이 잘못된 항목 → 해당 항목만 제외.
- 프로세스 조회 중 일부가 실패해도 나머지로 계속 수집하고, 전부
  실패하면 빈 목록을 반환한다 (이 경우 `pick_top_memory_process`는
  `None`을 반환하고, 화면에는 "관련 프로세스 후보 없음"으로 표시한다 —
  없는 프로세스를 추정해 보여주지 않는다).

## 한계 (SPEC에 기록)

- `virtual_memory().percent`는 Windows OS가 계산한 값을 그대로 쓰는
  것이며, TracePC가 별도로 재계산하지 않는다. 임계값 90%는 CPU와의
  일관성 및 위에서 설명한 계산 방식상의 근거에 기반한 실용적 기준선일
  뿐, 모든 PC 구성에서 절대적으로 "문제"를 의미하지는 않는다.
- "RAM 사용량이 높은 프로세스 후보"는 병목이 확정된 **그 순간의 스냅샷**
  기준이다. 병목의 "원인"이 아니라 "그 시점에 메모리를 많이 쓰고 있던
  후보"일 뿐이며, 화면 문구도 이를 반영한다.

## 이번 슬라이스에서 만들지 않을 것

- swap/pagefile 분석
- 프로세스 자동 종료, 메모리 회수 시도
- RAM 병목의 "원인" 단정, 해결 방법 제시
- Disk 분석 (별도 SPEC: `specs/disk-analysis.md`)
- 웹 화면 최종 디자인
