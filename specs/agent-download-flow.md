# SPEC — 웹: Agent 다운로드 및 연결 흐름

## 목표

다른 Windows PC 사용자가 **production Vercel URL만 알고** 시작해서,
화면의 단계별 안내만 보고 TracePC Agent를 다운로드·실행·연결하여
자신의 실제 CPU 사용률을 웹에서 확인할 수 있게 한다.

## 사용자 흐름

1. Vercel 사이트 접속
2. Windows용 TracePC Agent 다운로드 버튼 확인
3. Agent 다운로드
4. Agent 실행 안내 확인
5. 웹에서 6자리 연결 코드 발급
6. Agent에 같은 코드 입력
7. PC 연결 확인 또는 조회를 통해 CPU 데이터 수신 여부 확인
8. CPU 사용률과 마지막 측정 시각 표시

## 배치 및 재사용

- exe 파일: `public/downloads/TracePCAgent.exe` — `specs/agent-packaging.md`의
  빌드 산출물(`agent/dist/TracePCAgent.exe`)을 이 경로로 복사해
  커밋한다. 빌드 로직 자체는 변경 없음.
- 다운로드 URL: `https://pcproject-tau.vercel.app/downloads/TracePCAgent.exe`
  (Next.js가 `public/`을 그대로 정적 서빙).
- 기존 "연결 코드 발급", "CPU 상태 조회" 섹션과 로직
  (`fetchCpuStatus`, `/api/code`, `/api/data`)은 **수정 없이 그대로
  재사용**한다. 이번 슬라이스는 그 앞뒤에 다운로드 버튼과 안내
  텍스트만 추가한다.
- 화면 순서를 사용자 흐름 순서(다운로드 → 실행 안내 → 코드 발급 →
  Agent에 입력 안내 → 조회)에 맞게 재배열한다. 새로운 상태 관리나
  API는 추가하지 않는다.

## 화면에 추가할 최소 요소 (기능 중심, 디자인 없음)

1. **"1. Windows Agent 다운로드"** 섹션: `public/downloads/TracePCAgent.exe`로
   향하는 다운로드 링크/버튼 1개.
2. **"2. Agent 실행"** 섹션: 짧은 안내 텍스트만.
   - "다운로드한 `TracePCAgent.exe`를 더블클릭해 실행하세요."
   - "Windows가 '알 수 없는 앱' 경고를 표시하면 '추가 정보' → '실행'을
     눌러 계속 진행하세요."
3. **"3. 연결 코드 발급"** — 기존 섹션 그대로 재사용, 위치만 이동.
4. **"4. Agent에 코드 입력"** 섹션: "Agent 콘솔 창에 위에서 발급받은
   6자리 코드를 입력하세요."라는 안내 텍스트만 (새 로직 없음).
5. **"5. CPU 상태 조회"** — 기존 섹션 그대로 재사용, 위치만 이동.

## 완료 조건

1. 다른 Windows PC 사용자가 내 production Vercel URL만 알고 시작할
   수 있다.
2. Python, VS Code, Claude Code 등 개발 도구가 필요하지 않다.
3. 사이트에서 Agent 다운로드 경로를 찾을 수 있다.
4. 단계별 안내만 보고 연결할 수 있다.
5. Agent를 실행하고 코드 입력 후 실제 그 PC의 CPU가 웹에 표시된다.

## 검증 방법

- `npm run build` 후 `public/downloads/TracePCAgent.exe`가 빌드
  산출물에 포함되는지 확인 (새 순수 함수가 없으므로 단위 테스트
  추가 없음).
- 배포 후 production URL에서: 다운로드 버튼이 실제로 200 응답과
  올바른 파일 크기로 exe를 내려받는지 확인.
- 다운로드한 exe를 실행 → 새 연결 코드 입력 → 웹/API에서 같은 코드로
  조회 → 실제 CPU%/시각 표시까지 end-to-end 확인.

## 저장소 운영 원칙 (git 커밋 관련)

`public/downloads/TracePCAgent.exe`는 실제로 exe 내용이 바뀔 때만
다시 빌드해 갱신 커밋한다. 매 슬라이스마다 습관적으로 재커밋하지
않는다 (불필요한 git 이력 누적 방지).

## 이번 슬라이스에서 하지 않을 것

- CPU 과부하 판정 (`specs/cpu-overload.md`로 보관, 미구현)
- 관련 프로세스 분석, RAM/Disk 분석
- `[성능 분석]` 실제 분석 기능
- 최종 디자인/스타일링 (버튼·텍스트는 기능 중심 최소 마크업만)
- GitHub Release, CDN, 별도 다운로드 서버 등 새로운 배포 인프라
