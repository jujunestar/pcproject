# SESSION — 2026-08-29

## 오늘 완료한 상태

### 1. 기존 CPU 업로드/조회 슬라이스 production end-to-end 검증
- production Vercel(`https://pcproject-tau.vercel.app`)과 `/api/code`,
  `/api/data`가 정상 동작함을 확인.
- 실제 `python agent/main.py`를 실행해 연결 코드 입력 → 실제 CPU
  사용률 측정 → production API 업로드까지 확인.
- **버그 발견 및 수정**: `@upstash/redis`의 자동 (역)직렬화 때문에
  `GET /api/data`가 저장된 JSON 문자열을 이미 파싱된 객체로 돌려줘
  `lib/cpu-status.ts`가 항상 `데이터 형식을 확인할 수 없음`으로
  판정하던 문제. `app/api/data/route.ts`의 `Redis` 클라이언트에
  `automaticDeserialization: false` 한 줄 추가로 수정
  (커밋 `8f9eedd`). 수정 후 재검증까지 완료 — 웹이 실제로
  `데이터 수신됨` + CPU% + 측정 시각을 표시할 수 있는 상태로 확정.

### 2. CPU 과부하 판정 SPEC 작성 (구현 보류)
- `specs/cpu-overload.md` 작성: 90% 이상 CPU가 5초 이상 지속되는지
  실제 타임스탬프로 판정하는 로직의 SPEC. 데이터 부족/정상/과부하
  후보 3상태, 상수(`CPU_HIGH_THRESHOLD_PERCENT=90.0`,
  `MIN_SUSTAINED_SECONDS=5.0`, `MAX_SAMPLE_GAP_SECONDS=4.0`,
  `HISTORY_WINDOW_SECONDS=60.0`)와 경계조건, 샘플링 간격(2초) 때문에
  5초 지속이 실제로는 약 6초 시점에 처음 확인된다는 점까지 명시.
  **이번 세션에서는 SPEC만 작성, 구현은 하지 않음.**

### 3. Windows Agent PyInstaller 패키징
- `specs/agent-packaging.md` 작성: `--onefile --distpath agent/dist
  --workpath agent/build --specpath agent` 옵션으로 산출물 경로를
  문서와 정확히 맞춤.
- PyInstaller 설치, `agent/dist/TracePCAgent.exe`(~11.5MB) 빌드 성공.
- 같은 PC에서 exe를 직접 실행해 새 연결 코드로 CPU 측정 →
  production 업로드 → API/웹 파싱 로직까지 정상 확인.
- (참고) 자동화 테스트 중 발견: onefile exe는 표준출력을 파일로
  리다이렉트하면 완전 버퍼링되어 콘솔 로그가 안 보이고, 부트로더가
  내부적으로 별도 프로세스를 띄워 PID 기준 종료가 안 먹힘 — 실제
  더블클릭 사용에는 영향 없는, 자동화 테스트 방식의 한계로 기록.

### 4. Agent 다운로드 → 실행 → 연결 → CPU 표시 전체 흐름 (production 배포 완료)
- `specs/agent-download-flow.md` 작성 및 저장.
- `public/downloads/TracePCAgent.exe`에 exe 배치.
- `app/page.tsx`를 사용자 흐름 순서로 재정렬: 1.Agent 다운로드 →
  2.실행 안내(SmartScreen 경고 대응 포함) → 3.연결 코드 발급(기존
  로직 재사용) → 4.Agent에 코드 입력 안내 → 5.CPU 상태 조회(기존
  로직 재사용). 새 API/상태 로직은 추가하지 않음.
- **버그 발견 및 수정**: `.gitignore`의 Python 템플릿 `downloads/`
  규칙이 새 `public/downloads/`를 가리던 문제를
  `!/public/downloads/` 예외로 수정 (이전에 `lib/`에서 겪은 것과
  동일한 유형).
- `npm test`(8/8) / `typecheck` / `build` 모두 통과, 커밋 `cbd4c82`
  push, Vercel 재배포 확인.
- **production 실제 검증 완료**: `https://pcproject-tau.vercel.app/downloads/TracePCAgent.exe`가
  200 응답 + 로컬과 동일한 파일 크기(12,099,151 bytes)로 다운로드됨.
  그 exe를 실제로 다운로드해 실행 → 새 연결 코드 입력 → CPU 측정 →
  production 업로드 → 같은 코드로 웹이 쓰는 파싱 로직을 재현해
  `데이터 수신됨` 상태로 정상 표시됨을 확인. production 홈페이지
  HTML에 새 1~5단계 섹션이 실제로 배포됐음도 직접 확인.

### 5. 문서 정리
- `PLAN.md`: "[지금 느려요]" 3곳을 "[성능 분석]"으로 수정하고 이
  명칭 변경 결정을 "용어 변경" 섹션에 기록. `PRD.md`, 완료된
  `specs/cpu-agent.md`/`specs/cpu-web-display.md`는 과거 기록이라
  그대로 둠.

## 현재 상태 (production 기준)

**Python이나 개발 도구가 전혀 없는 다른 Windows PC 사용자가
`https://pcproject-tau.vercel.app` 접속만으로 시작해서, 화면의
1~5단계 안내를 따라 Agent를 다운로드·실행·연결하면 자신의 실제 CPU
사용률과 마지막 측정 시각이 웹에 표시되는 흐름**이 production에서
end-to-end로 동작함을 확인했다. 이것이 이 프로젝트의 핵심 사용자
흐름 골격이 처음으로 완성된 지점이다.

CPU 과부하 판정(90%/5초 지속)은 SPEC(`specs/cpu-overload.md`)까지만
있고 아직 구현되지 않았다. 관련 프로세스 분석, RAM/Disk, `[성능
분석]` 실제 분석 기능, 최종 디자인은 전부 아직 손대지 않았다.

## 다음 세션 Next Step

다음 작업은 **CPU 과부하 판단 + 고CPU 프로세스 수집 + 웹 성능 분석
결과 표시**다. 구체적으로:

1. `specs/cpu-overload.md`를 기준으로 CPU 과부하 판정 순수 함수를
   TDD로 구현하고, `agent/main.py`가 실제 측정 이력을 메모리에
   유지하며 매 측정 후 판정을 호출해 콘솔에 상태(`데이터 부족`/
   `정상`/`CPU 과부하 후보`)를 표시한다.
2. 과부하 후보로 판정된 구간에서 CPU 사용량이 가장 높은 프로세스
   (이름 + 수치)를 함께 수집하는 로직을 추가한다 (아직 SPEC 없음 —
   다음 세션에서 먼저 SPEC부터 작성 필요).
3. 위 결과를 실제로 웹에 업로드하고, `[성능 분석]` 버튼을 눌렀을 때
   웹 화면에 "CPU 과부하 원인 후보 + 관련 프로세스 + 측정 근거"가
   표시되는 기능을 구현한다 (`PLAN.md` 기능 3의 완료조건).

이번에도 vertical slice 원칙에 따라 한 번에 하나씩, 먼저 SPEC부터
작성해 확인받은 뒤 구현으로 넘어간다.
