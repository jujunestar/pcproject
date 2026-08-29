import type { PerformanceStatus } from "@/lib/performance-status";

type ConnectionState =
  | "initial"
  | "code-issued"
  | "no-data"
  | "connected"
  | "connection-failed";

function deriveConnectionState(code: string, connectionCheck: PerformanceStatus | null): ConnectionState {
  if (code === "") return "initial";
  if (connectionCheck === null) return "code-issued";
  if (connectionCheck.status === "received") return "connected";
  if (connectionCheck.status === "no-data") return "no-data";
  return "connection-failed";
}

const CONNECTION_STATE_TEXT: Record<ConnectionState, string> = {
  initial: "아직 연결 코드가 없습니다.",
  "code-issued": "코드가 발급됐습니다. Agent에 코드를 입력한 뒤 연결 확인을 눌러보세요.",
  "no-data": "Agent 데이터 미수신 — 아직 Agent에서 데이터가 도착하지 않았습니다.",
  connected: "연결 완료 — Agent 데이터가 정상적으로 수신되고 있습니다.",
  "connection-failed": "연결 실패 — 코드를 다시 확인하거나 잠시 후 다시 시도해보세요.",
};

export function StartScreen({
  code,
  inputCode,
  connectionCheck,
  onInputCodeChange,
  onIssueCode,
  onCheckConnection,
  onStartAnalysis,
  onViewHistory,
}: {
  code: string;
  inputCode: string;
  connectionCheck: PerformanceStatus | null;
  onInputCodeChange: (value: string) => void;
  onIssueCode: () => void;
  onCheckConnection: () => void;
  onStartAnalysis: () => void;
  onViewHistory: () => void;
}) {
  const connectionState = deriveConnectionState(code, connectionCheck);

  return (
    <main className="screen screen-start">
      <section className="panel panel-intro">
        <h1>TracePC</h1>
        <p>왜 PC가 느린지 측정 근거를 바탕으로 병목 후보를 찾습니다.</p>
        <p className="muted">CPU / RAM / Disk 세 가지를 측정해 분석합니다.</p>
      </section>

      <section className="panel">
        <h2>1. Windows Agent 다운로드</h2>
        <a href="/downloads/TracePCAgent.exe" download className="button button-secondary">
          TracePCAgent.exe 다운로드
        </a>
      </section>

      <section className="panel">
        <h2>2. 연결 코드 발급</h2>
        <button className="button" onClick={onIssueCode}>
          연결 코드 발급
        </button>
        {code && (
          <p className="code-display">
            발급된 코드: <strong>{code}</strong>
          </p>
        )}
      </section>

      <section className="panel">
        <h2>3. Agent에 코드 입력</h2>
        <p className="muted">Agent 콘솔 창에 위에서 발급받은 6자리 코드를 입력하세요.</p>
      </section>

      <section className="panel">
        <h2>4. 데이터 수신 / 연결 상태</h2>
        <label className="field">
          연결 코드
          <input value={inputCode} onChange={(e) => onInputCodeChange(e.target.value)} placeholder="연결 코드" />
        </label>
        <button className="button button-secondary" onClick={onCheckConnection} disabled={inputCode === ""}>
          연결 확인
        </button>
        <p className={`status-line status-line-${connectionState}`}>{CONNECTION_STATE_TEXT[connectionState]}</p>
      </section>

      <section className="panel panel-cta">
        <h2>5. 성능 분석 시작</h2>
        <button className="button button-primary" onClick={onStartAnalysis} disabled={inputCode === ""}>
          성능 분석 시작
        </button>
        <button className="link-button" onClick={onViewHistory} disabled={inputCode === ""}>
          히스토리 보기
        </button>
      </section>
    </main>
  );
}
