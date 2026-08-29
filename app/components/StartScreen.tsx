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
      <header className="workspace-header">
        <div className="workspace-brand"><span>⌁</span><strong>TracePC</strong></div>
        <p className={`workspace-connection workspace-connection-${connectionState}`}><i /> {CONNECTION_STATE_TEXT[connectionState]}</p>
      </header>

      <section className="start-hero">
        <p className="eyebrow">WINDOWS PERFORMANCE ANALYZER</p>
        <h1>PC 성능을<br />명확하게 확인하세요.</h1>
        <p>실제 CPU · RAM · Disk 데이터를 측정해<br />PC가 느려지는 병목 후보를 찾습니다.</p>
        <div className="start-hero-actions">
          <a href="/downloads/TracePCAgent.exe" download className="button button-secondary">Agent 다운로드</a>
          <button className="button button-issue" onClick={onIssueCode}>연결 코드 발급</button>
        </div>
      </section>

      <section className="connection-workspace">
        <div className="connection-code-area">
          <p className="eyebrow">CONNECTION CODE</p>
          <p className="code-display"><strong>{code || "------"}</strong></p>
          <p>Agent에 위 코드를 입력하세요.</p>
        </div>
        <div className="connection-action-area">
          <label className="field">연결 코드<input value={inputCode} onChange={(e) => onInputCodeChange(e.target.value)} placeholder="연결 코드" /></label>
          <button className="button button-secondary" onClick={onCheckConnection} disabled={inputCode === ""}>연결 확인</button>
          <p className={`status-line status-line-${connectionState}`}>{CONNECTION_STATE_TEXT[connectionState]}</p>
        </div>
      </section>

      <footer className="start-action-footer">
        <div><p className="eyebrow">READY WHEN YOU ARE</p><h2>연결이 완료되면 분석을 시작하세요.</h2></div>
        <button className="button button-primary" onClick={onStartAnalysis} disabled={inputCode === ""}>성능 분석 시작</button>
        <button className="link-button" onClick={onViewHistory} disabled={inputCode === ""}>히스토리 보기</button>
      </footer>
    </main>
  );
}
