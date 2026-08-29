# SPEC — Agent: PyInstaller Windows exe 패키징

## 목표

Python이나 개발 도구가 설치되지 않은 다른 Windows 10/11 PC에서 TracePC
Agent(exe)를 실행하고, 웹에서 발급받은 연결 코드를 입력하면 그 PC의
실제 CPU 사용률이 production TracePC 웹에 표시된다.

## 패키징 방식

저장소 루트에서 다음 명령으로 빌드한다.

```
pyinstaller --onefile --name TracePCAgent --distpath agent/dist --workpath agent/build --specpath agent agent/main.py
```

- `--onefile`: 단일 exe 생성 (시작 속도는 약간 느려지지만 배포 편의성
  우선 — MVP에서 허용).
- 콘솔 창을 유지해야 하므로(`연결 코드` 입력, 측정/업로드 로그 확인
  필요) `--noconsole`/`--windowed`는 사용하지 않는다.
- `--distpath agent/dist`: 최종 exe가 저장소 루트의 `dist/`가 아니라
  `agent/dist/`에 생성되도록 명시한다. (PyInstaller 기본값은 명령을
  실행한 위치 기준 `./dist`이므로, 이걸 지정하지 않으면 저장소
  루트에 `dist/`가 생겨 문서와 실제 산출물 위치가 어긋난다.)
- `--workpath agent/build`: 빌드 중간 산출물을 `agent/build/`에
  모은다 (기본값은 `./build`).
- `--specpath agent`: 생성되는 `.spec` 파일을 `agent/` 아래
  (`agent/TracePCAgent.spec`)에 둔다 (기본값은 명령 실행 위치).
- 엔트리포인트는 기존 `agent/main.py`를 코드 수정 없이 그대로
  사용한다. `agent/cpu_agent.py`는 `main.py`와 같은 폴더에 있으므로
  PyInstaller가 자동으로 함께 번들링한다 (별도 `--paths` 불필요).
- **PyInstaller는 Windows에서만 빌드 가능** (크로스 컴파일 불가) —
  반드시 Windows 환경에서 빌드.

## exe 실행 시 연결 코드 입력 방식

기존 `main.py`의 `input("연결 코드를 입력하세요 (6자리 영숫자): ")`
그대로 유지. exe를 더블클릭하면 콘솔 창이 뜨고 동일한 프롬프트가
나온다. **코드 변경 없음.**

## production API 연결 / CPU 측정·업로드 로직

기존 `BASE_URL = "https://pcproject-tau.vercel.app"` 하드코딩과
`cpu_agent.py`의 세 함수(`is_valid_connection_code`,
`measure_cpu_percent`, `upload_measurement`) 모두 **그대로 재사용**,
수정 없음. exe에 그대로 컴파일되어 들어간다.

## 완료 조건

1. Python/psutil/requests가 전혀 설치되지 않은 별도 Windows 10/11
   PC에서 `TracePCAgent.exe`를 더블클릭만으로 실행할 수 있다.
2. 그 PC에서 웹이 발급한 연결 코드를 입력하면 `연결됨`이 표시된다.
3. 그 PC의 실제 CPU 사용률이 콘솔에 출력되고 production API로
   업로드된다.
4. 같은 코드로 production 웹에서 조회하면 그 PC의 실제 CPU 사용률과
   측정 시각이 표시된다.
5. exe 파일 하나만 복사해도 다른 PC에서 동일하게 동작한다
   (경로/의존성 없음).
6. 빌드 산출물이 정확히 `agent/dist/TracePCAgent.exe` 경로에
   생성된다 (문서와 실제 동작 일치).

## end-to-end 검증 절차 (다른 Windows PC)

1. 빌드 PC(저장소 루트)에서 위 `pyinstaller` 명령 실행 →
   `agent/dist/TracePCAgent.exe` 생성 확인.
2. exe 파일 하나만 USB/클라우드 드라이브 등으로 대상 PC에 복사.
3. 대상 PC에 Python이 없음을 먼저 확인 (설치 없이 동작함을 보여주는
   대조군).
4. 대상 PC 브라우저에서 `https://pcproject-tau.vercel.app` 접속,
   연결 코드 발급.
5. 대상 PC에서 `TracePCAgent.exe` 더블클릭 → 코드 입력.
6. 콘솔에 `연결됨`, CPU 사용률, `업로드 성공` 로그 확인.
7. 같은 코드로 웹 조회 → 대상 PC의 실제 CPU 사용률/시각 표시 확인.
8. (근거 보강, 선택) 대상 PC 작업관리자 수치와 비교.

## 예상 위험 요소

- **SmartScreen 경고**: 서명 안 된 신규 exe라 "Windows에서 PC를
  보호했습니다" 경고 가능성 높음. 코드 서명은 2주 MVP 범위 밖 →
  "추가 정보 → 실행" 클릭이 필요함을 문서로만 안내 (자동 우회 없음).
- **백신 오탐**: PyInstaller onefile exe는 일부 백신에서 흔히
  오탐됨. 서명/예외처리 자동화는 범위 밖, 발생 시 수동 예외 등록
  안내만.
- **콘솔 창 노출**: 사용자가 실수로 콘솔 창을 닫으면 Agent가 즉시
  종료됨 — 이번 슬라이스에서는 그대로 허용.
- PyInstaller 최초 설치 필요 (`pip install pyinstaller`).

## 빌드 산출물 위치와 배포 방법

- 산출물: `agent/dist/TracePCAgent.exe` (단일 파일).
- 중간 산출물: `agent/build/` (임시 빌드 캐시), `agent/TracePCAgent.spec`
  (재빌드용 스펙 파일). 둘 다 커밋 대상 아님.
- 배포: 자동 배포/다운로드 페이지를 만들지 않는다. 개발자가 로컬에서
  빌드한 exe를 USB/클라우드 드라이브로 수동 전달한다 (과도한 배포
  인프라 지양).
- `agent/dist/`, `agent/build/`, `*.spec`은 이미 저장소 루트
  `.gitignore`의 `dist/`, `build/`, `*.spec` 규칙에 걸려 하위
  경로(`agent/dist/`, `agent/build/`, `agent/TracePCAgent.spec`)까지
  커밋되지 않는다 — 별도 조치 불필요.

## 이번 슬라이스에서 하지 않을 것

- CPU 과부하 판정 (`specs/cpu-overload.md`로 그대로 보관, 구현은
  다음 순번)
- 관련 프로세스 분석, RAM/Disk 분석
- `[성능 분석]` UI, 최종 디자인
- 코드 서명, SmartScreen 화이트리스트 등록, 자동 업데이트/배포
  파이프라인
