# SPEC — Agent: 고CPU 프로세스 후보 수집

## 목표

`specs/cpu-overload.md`의 판정 결과가 **CPU 과부하 후보**일 때, 그
순간 CPU 사용량이 가장 높은 프로세스 하나를 이름 + PID + CPU 사용률로
수집한다. 어떤 프로세스가 "원인"이라고 단정하지 않고 "후보"로만
제시한다 (CLAUDE.md 암묵지).

## 이번 슬라이스 완료 조건

1. 프로세스 목록에서 각 프로세스의 CPU 사용률 스냅샷을 수집하는 순수
   함수(`collect_process_samples`)를 TDD로 구현한다.
2. 수집된 스냅샷 중 CPU 사용률이 가장 높은 프로세스 하나를 고르는
   순수 함수(`pick_top_process`)를 TDD로 구현한다.
3. 접근 불가능하거나 조회 중 사라진 프로세스는 전체 수집을 실패시키지
   않고 해당 프로세스만 건너뛴다.
4. `agent/main.py`는 CPU 과부하 후보로 판정된 주기에서만 위 함수들을
   호출해 콘솔에 `관련 프로세스 후보: 이름 (PID nnn, CPU nn.n%)`를
   출력한다.
5. 기존 CPU 측정/판정/업로드 기능은 그대로 유지한다.

## 입력 / 출력

- `collect_process_samples(process_iter_fn)`
  - `process_iter_fn()`은 프로세스류 객체의 iterable을 반환한다. 각
    객체는 `.pid` 속성, `.name()`, `.cpu_percent(None)` 메서드를
    갖는다고 가정한다 (psutil.Process와 동일한 인터페이스).
  - 각 객체에서 pid/name/cpu_percent를 읽는 도중 예외(프로세스 종료,
    접근 권한 없음 등)가 발생하면 그 객체만 건너뛰고 나머지는 계속
    수집한다.
  - 반환값: `[{"pid": int, "name": str, "cpuPercent": float}, ...]`
    (수집 순서 유지, 값을 추정해 채우지 않는다).
- `pick_top_process(process_samples)`
  - `cpuPercent`가 가장 높은 항목 하나를 반환한다.
  - 비어 있으면 `None`.
  - 동률이면 목록에서 먼저 나온 항목을 반환한다 (결정적 동작).

## 실제 측정 방식 (main.py 통합, 근사 없이 실제 psutil 값 사용)

- `psutil.Process.cpu_percent(interval=None)`은 "마지막 호출 이후"의
  사용률을 반환하므로, 매 측정 주기 시작 시 프로세스 목록을 한 번 얻어
  각 프로세스에 대해 `cpu_percent(None)`을 먼저 호출해 기준점을
  찍는다 (priming).
- 그 직후 기존 시스템 전체 CPU 측정
  (`psutil.cpu_percent(interval=MEASURE_INTERVAL_SECONDS)`, 약 2초
  블로킹)이 끝나면, **같은 프로세스 객체들**에 대해 다시
  `cpu_percent(None)`을 호출해 그 2초 구간 동안의 실제 사용률을 얻는다.
- 새로 `process_iter`를 다시 부르지 않고 동일 객체를 재사용해야
  기준점이 유지된다 (그렇지 않으면 항상 0%에 가까운 값이 나온다).
- 이 수집은 매 주기 수행하되(다음 판정에 바로 쓸 수 있도록), 콘솔
  출력과 업로드는 CPU 과부하 후보로 판정된 주기에만 한다 (완료조건
  4번).

## 이번 슬라이스에서 만들지 않을 것

- 프로세스 자동 종료
- 여러 개의 관련 프로세스 후보 (1개만)
- RAM/Disk 기준 프로세스 분석
- 웹 화면 표시 (다음 슬라이스에서 `/api/data` payload에 포함해 표시)
