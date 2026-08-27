# SESSION — 2026-08-27

## 오늘 완료한 상태

- `specs/cpu-web-display.md` 작성: 연결 코드로 최신 CPU 측정값을 조회해
  웹에 표시하는 슬라이스의 스펙(입력, 표시, 실패 조건, 완료 조건).
- TDD로 `lib/cpu-status.ts` 구현 (`fetchCpuStatus`) + `lib/cpu-status.test.ts`
  (Vitest 8개, 모두 통과). 잘못된 코드 형식, 데이터 없음, API 실패,
  JSON/필드 오류 시 임의 값 생성 금지까지 커버.
- `app/page.tsx`에 연결해 "CPU 상태 조회" 화면 완성: 연결 코드 입력 →
  조회 → 상태(`데이터 수신됨` / `아직 수신된 데이터 없음` /
  `잘못된 연결 코드 형식` / `조회 실패` / `데이터 형식을 확인할 수 없음`)
  + CPU 사용률(%) + 마지막 측정 시각 표시. 기존 스켈레톤 테스트 UI는
  제거.
- `npm test`(8/8), `npm run typecheck`, `npm run build` 모두 통과.
- `.gitignore`의 Python 템플릿 `lib/` 규칙이 새 TypeScript `lib/`를
  가리던 문제를 `!/lib/` 예외로 수정.
- 커밋 `b37bd7e`를 `main`에 push, Vercel 자동 배포 완료 확인
  (`https://pcproject-tau.vercel.app`).
- 배포 URL의 정적 HTML(`curl`)과 `/api/code`, `/api/data` 응답을 직접
  호출해 새 화면과 API가 살아있음을 확인.

## 아직 직접 확인하지 못한 end-to-end 검증

- 브라우저에서 "조회" 버튼을 실제로 클릭했을 때 자바스크립트가 실행되어
  화면 상태(`데이터 수신됨`/CPU%/시각)가 올바르게 렌더링되는지 — 브라우저
  자동화 도구가 없어 직접 클릭 테스트를 하지 못함.
- 실제 Windows Agent(`python agent/main.py`)가 프로덕션 URL로 CPU
  데이터를 업로드하고, 같은 코드로 웹에서 조회했을 때 `데이터 수신됨`
  상태로 CPU 사용률과 측정 시각이 정확히 표시되는지 — 이번 세션에서는
  Agent를 프로덕션 URL로 실행해 보지 않음.

## 다음 세션에서 가장 먼저 할 일

1. 로컬 또는 배포된 웹에서 브라우저로 직접 "조회" 버튼을 눌러 5가지
   상태(수신됨/데이터 없음/잘못된 형식/조회 실패/형식 오류)가 화면에
   올바르게 나타나는지 눈으로 확인한다.
2. `python agent/main.py`를 실제로 실행해 프로덕션 배포 URL로 CPU
   데이터를 업로드하고, 같은 연결 코드로 웹에서 조회해 end-to-end로
   CPU 사용률과 측정 시각이 표시되는지 확인한다.
3. 위 두 가지가 확인되면 PLAN.md의 다음 기능(CPU 90% 이상 5초 지속
   판별 + 관련 프로세스 근거 표시, [지금 느려요])으로 넘어간다.
