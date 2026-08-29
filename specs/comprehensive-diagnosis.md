# SPEC — Web: CPU/RAM/Disk 종합 진단

## 목표

이미 각각 완료·검증된 CPU 과부하 후보 / RAM 병목 후보 / Disk I/O 병목
후보 세 결과를, 웹 화면 한 곳에 "가장 의심되는 병목 후보"로 요약해서
보여준다.

이 기능은 **새로운 측정을 하지 않는다.** Agent가 이미
`/api/data`로 올려준 CPU/RAM/Disk 각각의 상태(`overloadStatus` /
`ramStatus` / `diskIoStatus`), 판정 근거(evidence), 관련 프로세스
후보(topProcess)를 **웹 `lib/` 레이어의 순수 함수로 조합**만 한다.
`agent/*.py`, PyInstaller exe는 이번 슬라이스에서 전혀 수정하지
않는다.

이 프로젝트의 암묵지를 그대로 따른다: 측정하지 않은 "원인"을 절대
단정하지 않으며, 이 화면에서도 "원인" 대신 항상 **"병목 후보"**라는
표현만 사용한다.

## 이번 슬라이스 완료 조건

1. `lib/comprehensive-diagnosis.ts`에 순수 함수
   `evaluateComprehensiveDiagnosis(status)`를 TDD로 구현한다. 입력은
   `lib/performance-status.ts`의 `PerformanceStatus`에서
   `status: "received"`인 경우의 값 그대로다.
2. 기존 CPU/RAM/Disk 개별 판정 함수(`lib/performance-status.ts`의
   파싱 로직, `agent/*_agent.py`의 판정 함수)는 전혀 수정하지
   않는다 — 이미 완료·검증된 판정 결과를 그대로 입력받아 조합만 한다.
3. `app/page.tsx`의 `[성능 분석]` 결과 화면에, 기존 CPU/RAM/Disk 3개
   상세 섹션은 그대로 둔 채(수정하지 않음) 그 **위에** 종합 진단
   요약 카드를 새로 추가한다.
4. 백분율(%) 값은 CPU/RAM/Disk 리소스 간에 서로 비교하지 않는다
   (Disk 활성 시간은 100%를 초과할 수 있어 척도 자체가 다름).
   유일하게 세 리소스가 동일한 알고리즘·동일한 단위(초)로 계산하는
   `durationSeconds`(지속시간)만 리소스 간 비교에 사용한다.

## 입력 데이터

`evaluateComprehensiveDiagnosis`는 `PerformanceStatus`의
`{ status: "received"; ... }` 케이스 전체를 입력으로 받는다 (CPU
필드는 항상 존재, `ram`/`disk`는 구버전 Agent 호환을 위해 `null`일
수 있음 — `lib/performance-status.ts` 참고).

각 리소스를 아래 둘 중 하나로 분류한다.

- **후보(candidate)**: CPU는 `overloadStatus === "overload-candidate"`
  이고 `overloadEvidence`가 있는 경우. RAM/Disk는 `ram`/`disk`가
  `null`이 아니고 각각 `status === "bottleneck-candidate"` /
  `ioStatus === "bottleneck-candidate"`이며 evidence가 있는 경우.
- **비후보(non-candidate)**: 그 외 전부 — `normal`, `insufficient-data`,
  그리고 `ram`/`disk`가 `null`인 구버전 Agent payload(측정 자체가
  없었던 것으로 취급, `insufficient-data`와 동일하게 다룬다).

## 순위 규칙 (2개 이상 동시 후보)

CPU%, RAM%, Disk 활성 시간%는 서로 다른 척도라 크기로 직접 비교하면
"측정하지 않은 심각도"를 단정하는 것이 된다. 반면 세 리소스 모두
동일한 `MIN_SUSTAINED_SECONDS` 기반 알고리즘으로 `durationSeconds`를
계산하므로, 이것만은 실제로 측정된 공통 단위(초)다. **오직
`durationSeconds`만으로 순위를 매긴다.**

1. **후보가 0개** → "병목 후보 없음" (아래 표시 규칙 참고).
2. **후보가 1개** → 그 하나가 **"가장 의심되는 병목 후보"**.
3. **후보가 2개 이상**:
   - 후보들의 `durationSeconds` 중 최댓값을 구한다.
   - 최댓값을 가진 후보가 **정확히 1개**면, 그 후보가 **"가장 의심되는
     병목 후보"**이고 **나머지 후보 전부**(자기들끼리 지속시간이
     같든 다르든 상관없이)는 **"동시에 감지된 병목 후보"**로 모두
     표시한다.
   - 최댓값을 가진 후보가 **2개 이상**(동률)이면, "가장 의심되는"이라는
     단일 표현을 임의로 만들지 않는다. 이 경우 **현재 후보 전부**를
     (최댓값 동률 그룹뿐 아니라 그보다 짧은 후보가 있어도 전부)
     **"동시에 감지된 병목 후보"**로 표시한다 — 아무도 단독 대표로
     뽑히지 않았기 때문에, 순위를 매길 수 없는 후보 전체를 동등하게
     취급한다.
   - 나열 순서는 항상 CPU → RAM → Disk 고정이다. 이 순서는 **표시
     순서일 뿐 우선순위가 아니다** — 실제 판단은 오직 `durationSeconds`
     비교로만 한다.

**동률이 실제로 발생할 수 있는 이유**: `agent/main.py`는 한 루프
반복에서 CPU/RAM/Disk 이력에 **동일한 `measured_at` 문자열**을 그대로
재사용해 추가한다. 따라서 두 리소스가 같은 루프 구간들에서 함께
임계값을 넘기면 `startedAt`/`endedAt`이 우연이 아니라 실제로 동일한
경우가 흔할 수 있고, 이 경우 `durationSeconds`도 정확히 같은 값이
된다. 그래서 동률 처리는 예외적인 극단 케이스가 아니라 실제로 발생
가능한 정상 케이스로 취급한다.

**예시 (모순 없이 확인)**: RAM이 6.0초, Disk가 7.0초 동시에 병목
후보라면, 지속시간이 더 긴 **Disk가 "가장 의심되는 병목 후보"**이고
RAM은 "동시에 감지된 병목 후보"로 표시된다. RAM이 6.0초, Disk도
6.0초로 완전히 같다면 단일 대표를 정하지 않고 **"동시에 감지된 병목
후보: RAM, Disk"**로 표시한다.

## insufficient-data 처리 규칙

- **셋 다 insufficient-data(또는 `ram`/`disk`가 `null`)** → 후보를
  전혀 언급하지 않고 **"아직 판단할 데이터가 부족합니다"**만 표시한다.
- **후보가 1개 이상 있는데 다른 리소스가 insufficient-data** → 후보는
  정상적으로 위 순위 규칙대로 표시하고, insufficient-data인 리소스는
  화면 하단에 "RAM: 데이터 부족"처럼 별도로 명시한다(숨기지 않음).
- **후보가 0개이고, `normal`과 insufficient-data가 섞여 있음** →
  "모두 정상"이라고 말하지 않는다. 정상으로 확인된 리소스와 아직
  데이터가 부족한 리소스를 구분해서 표시한다(예: "CPU, Disk 정상
  확인, RAM 데이터 부족").

## 모두 정상일 때 표현

후보가 0개이고 세 리소스 모두 `normal`이면:

> 측정한 CPU/RAM/Disk 범위에서 병목 후보가 발견되지 않았습니다

"문제 없음"처럼 과장하지 않는다 — GPU/네트워크 등은 이 서비스의 측정
범위 밖이므로, 그 범위를 넘어서는 주장을 하지 않는다.

## 관련 프로세스 후보·근거 요약 표시

기존 CPU/RAM/Disk 상세 섹션(변경 없음) 위에 요약 카드를 추가한다.
카드는 헤드라인 한 줄과, 후보가 있으면 후보별 근거·관련 프로세스
후보를 리소스 고유 단위 그대로(CPU: %, RAM: % + MB, Disk: % + KB/s)
표시한다 — 억지로 공통 단위로 뭉개지 않는다.

```
[요약 카드]
가장 의심되는 병목 후보: Disk

Disk — 최고 132.5%, 12:00:01~12:00:08 (7.0초 지속)
  관련 프로세스 후보: chrome.exe (PID 8821, 512.4KB/s)

동시에 감지된 병목 후보
RAM — 최고 94.0%, 11:59:44~11:59:50 (6.0초 지속)
  관련 프로세스 후보: powershell.exe (PID 5336, 7007.3MB)

CPU: 정상 (32.1%)
```

시각(`startedAt`/`endedAt`)의 사람이 읽는 로컬 시간 변환은 기존
CPU/RAM/Disk 섹션과 동일하게 화면 렌더링 시점(`app/page.tsx`)에서
`toLocaleTimeString()`으로 처리한다 — 순수 함수
`evaluateComprehensiveDiagnosis`는 타임존에 의존하는 문자열을
만들지 않고 ISO 원본 문자열을 그대로 반환한다(테스트 결과가 실행
환경의 타임존에 따라 달라지지 않게 하기 위함).

## 이번 슬라이스에서 만들지 않을 것

- 새로운 측정, Agent/exe 수정
- CPU/RAM/Disk 개별 판정 로직 변경
- "원인" 단정, 해결 방법 제시
- 병목 후보 간 심각도를 percent 크기로 비교하는 로직
- 최종 UI 디자인/스타일링 (요약 카드는 기존 섹션과 동일한 최소한의
  스타일만 사용한다)
