# SPEC — Agent: Disk 분석 (용량 사용률 vs I/O 성능 병목)

## 목표

Disk와 관련해 사용자에게 보여줄 정보를 **성격이 다른 두 가지**로
명확히 분리한다.

1. **Disk 용량 사용률** — 드라이브가 얼마나 찼는지. 정보 제공 목적일
   뿐, 이 값만으로 "성능 병목"을 판정하지 않는다.
2. **Disk I/O 성능 병목 후보** — 디스크가 실제로 얼마나 바쁘게
   읽기/쓰기를 처리하고 있는지에 대한 실측 근거로만 판정한다.

`C:` 드라이브가 90% 찼다는 이유만으로 "Disk 성능 병목 후보"라고
판정하는 것은 이 프로젝트의 암묵지("측정하지 않은 원인을 단정하지
않는다")를 위반하는 것이므로, 코드 구조상으로도 두 값을 절대 같은
판정 함수에 섞지 않는다.

## 사전 조사 — Windows에서 psutil로 실제로 안정적으로 얻을 수 있는 값

이 저장소가 있는 Windows 환경에서 `psutil==7.2.2`를 직접 실행해 확인한
실측 결과다 (추정 아님).

```
>>> psutil.disk_usage("C:/")
sdiskusage(total=511046217728, used=271363379200,
           free=239682838528, percent=53.1)

>>> psutil.disk_partitions()
[sdiskpart(device='C:\\', mountpoint='C:\\', fstype='NTFS', opts='rw,fixed'),
 sdiskpart(device='G:\\', mountpoint='G:\\', fstype='FAT32', opts='rw,fixed')]

>>> psutil.disk_io_counters()
sdiskio(read_count=2536486, write_count=1239045,
        read_bytes=65295727616, write_bytes=37335640064,
        read_time=13373, write_time=14446)
```

확인된 사실:

- `disk_usage(path)`는 **용량**(`total`/`used`/`free`/`percent`, byte
  단위, `percent`는 %)만 제공한다. I/O 성능에 대한 정보는 전혀 담고
  있지 않다 — 그래서 절대 성능 판정에 쓰지 않는다.
- `disk_io_counters()`는 **부팅 이후 누적값**이다 (그 순간의 사용률이
  아니다). 필드: `read_count`, `write_count`, `read_bytes`,
  `write_bytes`, `read_time`, `write_time`. **Windows에서는 Linux의
  `busy_time` 필드가 존재하지 않는다** (psutil 문서 및 이 환경에서
  `hasattr(counters, "busy_time")`이 `False`로 실측 확인됨). 따라서
  Windows 작업 관리자의 "활성 시간(Active time) %"과 동일한 값을
  psutil에서 바로 얻을 수는 없고, **직접 두 값을 계산**해야 한다.
- `read_time`/`write_time`은 "누적 읽기/쓰기에 소요된 시간(ms)"이다.
  두 시점의 `disk_io_counters()`를 샘플링해 `(read_time + write_time)`의
  증가분을, 같은 구간의 실제 경과 시간(ms)으로 나누면 "그 구간 동안
  디스크가 I/O 처리에 바빴던 시간의 비율(%)"을 근사할 수 있다. 이는
  Windows 리소스 모니터의 디스크 "활성 시간" 그래프와 개념적으로
  동일한 지표다.
- `disk_io_counters(perdisk=True)`로 물리 디스크별 값도 얻을 수
  있지만, 이번 슬라이스는 시스템 전체 집계값(`perdisk=False`, 기본값)
  하나만 사용한다 (여러 디스크가 있는 PC에서 "어떤 드라이브가
  문제인지" 특정하는 것은 범위 밖 — 한계로 명시).
- 프로세스별로는 `psutil.Process.io_counters()`가 실제로 값을 반환한다
  (`read_bytes`, `write_bytes` 등, 프로세스 시작 이후 누적). 이
  환경에서 조회 가능한 279개 프로세스 전부 예외 없이 조회에 성공했지만,
  **권한 부족(AccessDenied)이나 조회 중 프로세스 종료로 실패할 수
  있음을 방어적으로 처리한다** (다른 Windows 환경/권한에서는 실패할
  수 있음).

## 이번 슬라이스 완료 조건

1. Disk **용량** 정보를 그대로 파싱/검증하는 순수 함수
   (`parse_disk_capacity`)를 TDD로 구현한다. 이 함수는 병목 판정을
   전혀 하지 않는다 — 수치 파싱/검증만 한다.
2. 두 시점의 `disk_io_counters()`로부터 "디스크 활성 시간 비율(%)"을
   계산하는 순수 함수(`compute_disk_active_percent`)를 TDD로
   구현한다.
3. 활성 시간 비율 이력을 바탕으로 **데이터 부족 / 정상 / Disk I/O
   성능 병목 후보**를 판정하는 순수 함수(`evaluate_disk_io_status`)를
   TDD로 구현한다.
4. 프로세스별 I/O 사용량(속도, bytes/sec)을 계산하는 순수 함수
   (`collect_process_io_snapshot`, `compute_disk_io_deltas`,
   `pick_top_disk_io_process`)를 TDD로 구현한다.
5. `agent/main.py`는 매 측정 주기 Disk 용량과 활성 시간 비율을
   측정해 콘솔에 표시하고, Disk I/O 병목 후보로 **새로** 확정된
   주기에만 프로세스 I/O 후보 수집을 실행한다.
6. 기존 CPU 판정/업로드 로직과 `agent/cpu_agent.py`는 수정하지 않는다.

## Disk 용량 사용률 (정보 제공, 병목 아님)

- `psutil.disk_usage(system_drive)`로 시스템 드라이브
  (`os.environ["SystemDrive"] + "\\"`, 보통 `C:\`) 용량을 측정한다.
- `parse_disk_capacity(usage)` 입력: `total`/`used`/`free`/`percent`
  속성(또는 동일 키의 dict)을 가진 객체. 출력:
  `{"totalBytes", "usedBytes", "freeBytes", "percent"}` 또는, 필드가
  없거나 타입이 잘못됐으면 `None`.
- 화면에는 항상 "용량 사용률"이라는 명칭으로만 표시하고, "병목",
  "느림" 등 성능을 암시하는 단어를 붙이지 않는다.
- **판정 없음**: 이 값에는 상태(정상/병목 후보)가 없다. 그냥 사실을
  보여준다.

## Disk I/O 성능 병목 후보 판정

### 활성 시간 비율 계산

`compute_disk_active_percent(before, after, before_time, after_time)`

- `before`/`after`: 서로 다른 두 시점의 `disk_io_counters()` 결과
  (또는 `read_time`/`write_time` 속성을 가진 객체).
- `before_time`/`after_time`: 그 두 시점의 단조 시계(monotonic) 초
  단위 값.
- `busy_ms = (after.read_time + after.write_time) - (before.read_time + before.write_time)`
- `elapsed_ms = (after_time - before_time) * 1000`
- `elapsed_ms <= 0`이면 (시간이 거꾸로 갔거나 0이면) 계산 불가 →
  `None` 반환 (값을 추정해 채우지 않는다).
- `busy_ms < 0`이면 (카운터가 리셋된 것으로 판단, 예: OS 재부팅 없이
  발생하지 않아야 하지만 방어적으로 처리) → `None` 반환.
- 정상 케이스: `percent = busy_ms / elapsed_ms * 100`. **이 값은
  이론적으로 100을 넘을 수 있다** (동시에 여러 I/O 요청이 겹쳐 처리될
  때 `read_time`+`write_time` 합산이 실제 경과 시간보다 커질 수 있음 —
  이는 버그가 아니라 "그만큼 큐가 밀려 있다"는 신호이므로 인위적으로
  100에서 잘라내지 않는다. 이 한계를 SPEC과 화면 문구에 명시한다).

### 이력 판정 (`evaluate_disk_io_status`)

`specs/cpu-overload.md`와 동일한 구조를, `diskActivePercent` /
`DISK_ACTIVE_HIGH_THRESHOLD_PERCENT`에 대해 적용한다.

| 상수 | 값 | 근거 |
|---|---|---|
| `DISK_ACTIVE_HIGH_THRESHOLD_PERCENT` | `90.0` | 활성 시간 비율은 개념상 0~100(초과 가능)% 범위의 "얼마나 바빴는가" 지표이므로, CPU와 동일한 척도(90% 이상 = 거의 쉼 없이 처리 중)를 그대로 적용할 수 있다. Windows 리소스 모니터도 디스크 활성 시간이 100%에 가까울 때 시각적으로 포화 상태임을 강조하는 것과 같은 맥락이다. |
| `MIN_SUSTAINED_SECONDS` | `5.0` | RAM과 동일한 이유 — CPU와 같은 루프 주기에서 수집되므로 동일한 최소 지속시간을 적용해 순간적인 버스트(짧은 파일 복사 등)만으로 병목 후보로 단정하지 않는다. |
| `MAX_SAMPLE_GAP_SECONDS` | `10.0` | CPU/RAM과 같은 루프에서 측정되므로 동일한 근거(실측 루프 간격 4~5초의 2배)를 그대로 적용한다. |
| `HISTORY_WINDOW_SECONDS` | `60.0` | CPU/RAM과 동일. |

판정 로직(1~5단계)은 `specs/cpu-overload.md`, `specs/ram-analysis.md`와
완전히 동일한 구조이며, 대상 필드만 `diskActivePercent`로 바뀐다.

## 관련 프로세스 후보 (Disk I/O)

`process.io_counters()`도 **부팅/프로세스 시작 이후 누적값**이라
CPU의 `cpu_percent(interval=None)`처럼 "직전 호출 이후"를 자동
계산해주지 않는다. 따라서 CPU 프로세스 후보 수집과 동일한 2단계
프라이밍 방식을 쓴다.

1. `collect_process_io_snapshot(process_iter_fn)`: 그 순간 각
   프로세스의 `pid`, `name()`, `io_counters().read_bytes`,
   `io_counters().write_bytes`를 읽어
   `{"pid", "name", "readBytes", "writeBytes"}` 목록으로 수집한다.
   조회 중 예외(접근 거부, 프로세스 종료, `io_counters` 미지원 등)가
   발생한 프로세스는 건너뛴다.
2. Disk I/O 병목 후보로 **새로** 확정된 주기에, 위 스냅샷을 한 번
   찍고(`before`) `PROCESS_SAMPLE_SECONDS`(=1초, CPU와 동일 값)만큼
   대기한 뒤 다시 한 번 찍는다(`after`).
3. `compute_disk_io_deltas(before, after, elapsed_seconds)`: `pid`
   기준으로 두 스냅샷을 매칭해
   `bytesPerSec = ((after.readBytes + after.writeBytes) - (before.readBytes + before.writeBytes)) / elapsed_seconds`
   를 계산한다.
   - `elapsed_seconds <= 0`이면 빈 목록 반환.
   - 한쪽 스냅샷에만 있는 `pid`(그 사이 시작/종료된 프로세스)는
     델타를 계산할 수 없으므로 결과에서 제외한다.
   - 델타가 음수면(카운터 리셋 등 비정상 상황) 그 프로세스는 제외한다
     (없는 값을 추정해 채우지 않는다).
4. `pick_top_disk_io_process(delta_samples)`: `bytesPerSec`이 가장 큰
   프로세스 하나. 비어 있으면 `None`. 동률이면 먼저 나온 항목.
   **`SYSTEM_IDLE_PROCESS_PID(=0)`은 CPU/RAM과 동일한 이유로 항상
   제외한다.**
5. 이 프라이밍+대기는 병목 후보가 **새로** 확정된 주기에만 1회
   실행한다(`should_collect_disk_process_samples` — CPU의
   `should_collect_process_samples`와 동일한 원칙). 매 주기 무조건
   실행하지 않는다 — CPU 슬라이스에서 겪은 "판정용 측정 간격을
   프로세스 수집 비용이 오염시키는" 문제를 반복하지 않기 위함이다.

### Windows 특수 프로세스에 대한 참고 (제외하지 않음)

Windows에서 PID 4 `System` 프로세스는 파일 캐시 매니저 등 커널 모드
I/O가 이 프로세스에 귀속되어 실제로 매우 높은 `io_counters` 값을
보일 수 있다. 이는 psutil의 오류나 CPU 슬라이스의 System Idle
Process 문제(무의미한 값)와 다르게 **실제로 측정된 I/O 활동**이므로
임의로 제외하지 않는다. 다만 일반 사용자가 이해하기 어려울 수 있어,
화면에는 "관련 프로세스 후보"로만 표시하고 그 프로세스를 종료하라는
등의 조치를 권하지 않는다 (이번 슬라이스에서 해결 방법 제시 자체를
하지 않으므로 자연히 지켜진다).

## 데이터 부족/누락 시 처리

- `disk_io_counters()`가 `read_time`/`write_time`을 제공하지 않는
  플랫폼/상황이면 `compute_disk_active_percent`가 `None`을 반환하고,
  그 주기는 이력에 추가하지 않는다(측정 실패로 취급, CPU의 측정 실패
  처리와 동일).
- 활성 시간 비율 이력이 비어 있거나 1개뿐 → 데이터 부족.
- 아직 5초를 채우지 못한 진행 중인 고활성 구간 → 데이터 부족.
- 프로세스 I/O 스냅샷 중 일부 실패 → 해당 프로세스만 제외, 나머지로
  계속.
- **용량 정보는 애초에 "판정"이 없으므로** 데이터가 없으면 그냥
  표시하지 않는다(성능 상태와 무관하게 항상 독립적으로 노출).

## 한계 (SPEC에 기록)

- 활성 시간 비율은 여러 물리 디스크가 있는 PC에서는 집계값이라 "어떤
  드라이브가 병목인지"까지는 알 수 없다 (perdisk 분리는 범위 밖).
- 값이 100%를 넘을 수 있다는 것 자체가 근사치라는 한계이며, 정확한
  디스크 큐 길이(Queue Length)는 psutil로 얻을 수 없다 (Windows
  Performance Counter/WMI 영역, 이번 스택 범위 밖).
- Disk 용량 사용률이 아무리 높아도(예: 95%) 그 자체만으로는 절대
  "Disk 성능 병목 후보"라고 표시하지 않는다 — 반드시 활성 시간 비율
  실측 근거가 있어야 한다.

## 이번 슬라이스에서 만들지 않을 것

- 물리 디스크별(perdisk) 분리 분석
- 디스크 큐 길이, SMART 정보 등 psutil이 제공하지 않는 값
- 프로세스 자동 종료, 파일 자동 삭제
- Disk 병목의 "원인" 단정, 해결 방법 제시
- 웹 화면 최종 디자인
