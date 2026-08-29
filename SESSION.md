# SESSION — 2026-08-29 (2)

## 오늘 완료한 상태

이전 세션에서 완성한 "Agent 다운로드 → 실행 → 연결 → CPU 표시"
골격 위에, `PLAN.md` 기능 3(CPU 과부하 원인 후보 + 관련 프로세스 +
측정 근거)을 **하나의 vertical slice로 SPEC → TDD → 구현 → exe
재빌드 → production 배포 → E2E 검증까지** 끝까지 진행했다.

### 1. CPU 과부하 판정 (`specs/cpu-overload.md` 구현)

- `agent/cpu_agent.py`에 `evaluate_overload_status`, `trim_history`,
  `format_overload_status_line`를 TDD로 구현. 상태값은
  `insufficient-data` / `normal` / `overload-candidate` 세 가지이며,
  SPEC의 모든 경계조건(임계값 90.0%, 지속 5.0초, 최대 공백 4.0초,
  이력 보관 60초, 유효하지 않은 항목 무시, 값을 임의 보간하지
  않음)을 테스트로 명시했다.
- `agent/main.py`가 실제 측정 성공마다 이력에 추가 → 60초 창으로
  trim → 판정 → 콘솔에 `상태: ...` 한 줄을 추가 출력하도록 연결.
  기존 CPU 측정/업로드 로직은 그대로 유지.
- 실제로 `python agent/main.py`를 실행해 진짜 CPU 값으로 `데이터
  부족` → `정상` 전이와 production 업로드 성공을 직접 확인함.

### 2. 고CPU 프로세스 후보 수집 (`specs/cpu-process-candidates.md` 신규 작성)

- 최소 SPEC을 새로 작성(`specs/cpu-process-candidates.md`): 과부하
  후보로 판정된 주기에만 프로세스 CPU 스냅샷을 수집해 1개(최고
  사용률) 후보만 이름+PID+수치로 제시. 접근 불가/소멸 프로세스는
  건너뛴다.
- `agent/cpu_agent.py`에 `collect_process_samples`,
  `pick_top_process`를 TDD로 구현 (fake process 객체로 접근 거부/
  프로세스 소멸 시나리오까지 테스트).
- `agent/main.py`가 매 주기 프로세스 목록을 프라이밍(`cpu_percent(None)`
  선호출) → 시스템 CPU 측정(블로킹 2초) → 같은 프로세스 객체로 재측정
  하는 방식으로 실제 측정값을 얻는다(추정/보간 없음). 과부하 후보로
  판정된 주기에만 콘솔에 `관련 프로세스 후보: ...`를 출력하고
  업로드 payload에 포함한다.

### 3. 웹 [성능 분석] 완성

- `/api/data`에 저장되는 `value` JSON 형식을 확장:
  `cpuPercent`, `measuredAt`에 더해 `overloadStatus`,
  `overloadEvidence`(null 또는 시작/종료/지속시간/최고값),
  `topProcess`(null 또는 pid/name/cpuPercent)를 포함. 세 필드 중
  하나라도 형식이 잘못되면 임의로 채우지 않고 `invalid-format`으로
  처리하도록 `lib/cpu-status.ts`의 `parseValue`를 TDD로 확장.
- `app/page.tsx` 5단계를 "CPU 상태 조회"에서 "성능 분석"으로
  바꾸고, 상태를 `데이터 부족` / `CPU 과부하 근거 없음` /
  `CPU 과부하 후보`로 표시. 과부하 후보일 때만 판정 근거(최고
  CPU%, 시작~종료 시각, 지속 시간)와 관련 프로세스 후보를 함께
  표시. "원인을 단정하지 않는다"는 프로젝트 암묵지에 맞춰 항상
  "후보"라는 표현을 사용.

### 4. 검증

- `agent`: `python -m pytest` 39개 전체 통과.
- 웹: `npm test`(vitest) 13개 전체 통과, `npm run typecheck`,
  `npm run build` 모두 통과.
- `pyinstaller --onefile --name TracePCAgent --distpath agent/dist
  --workpath agent/build --specpath agent agent/main.py`로 새 코드
  기준 exe 재빌드 → `public/downloads/TracePCAgent.exe` 교체.
- 새로 빌드한 exe를 로컬에서 실제로 실행해 임시 연결 코드로 production
  `/api/data`에 새 payload 형식(`overloadStatus`/`overloadEvidence`/
  `topProcess` 포함)이 실제로 업로드되는 것을 직접 확인.
- 실제 개발 PC의 CPU가 90%/5초 조건을 자연 상태에서 만족하지 않으므로
  (그리고 의도적으로 위험한 부하를 걸지 않기로 한 지침에 따라)
  **CPU 과부하 후보 판정 자체는 자동화 테스트 데이터로만 검증**했고,
  production에서는 "실제 CPU 값이 Agent → 서버 → 웹 성능 분석까지
  정상 전달되는지"(정상/데이터 부족 경로)를 실측으로 확인했다.
- `git commit` 및 `git push` 완료, Vercel production 재배포 확인.

## 현재 상태 (production 기준)

`PLAN.md` 기능 1~3이 모두 production에 배포되어 동작한다. 웹에서
연결 코드 발급 → Agent 다운로드/실행/연결 → 실제 CPU 측정·업로드 →
[성능 분석] 클릭 시 데이터 부족/CPU 과부하 근거 없음/CPU 과부하
후보 중 하나가 실제 측정 근거와 함께 표시되는 흐름이 end-to-end로
동작함을 확인했다.

CPU 과부하 후보 상태의 실제 화면 표시는 (위험한 인위적 고부하를
걸지 않았으므로) production에서 실측 데이터로 직접 눈으로 확인하지는
않았다 — 판정 로직 자체는 자동화 테스트로, 정상/데이터 부족 경로는
실측으로 검증했다. 필요하면 다음 세션에서 안전한 부하 테스트 도구로
직접 재현해 볼 수 있다.

## 다음 세션 Next Step

- RAM / Disk 분석은 아직 손대지 않았다 (`PRD.md` MVP 범위,
  `PLAN.md`에는 없음 — 별도 논의 필요).
- 최종 UI 디자인은 그대로 미착수 상태.
- 원한다면, 실제로 CPU 과부하 후보 상태가 웹에 표시되는 모습을
  안전한 방식(예: 짧은 시간만 의도적 CPU 부하 도구 실행)으로 직접
  눈으로 확인하는 세션을 가질 수 있다.
