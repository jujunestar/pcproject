"use client";

import { useEffect, useState } from "react";
import { describeHistoryEntries, summarizeHistory } from "@/lib/history-summary";
import { fetchHistoryEntries, type PerformanceStatus } from "@/lib/performance-status";

type ReceivedStatus = Extract<PerformanceStatus, { status: "received" }>;

type LoadState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "loaded"; entries: ReceivedStatus[] };

function dotClassFor(statusLabel: string): "ok" | "warn" | "neutral" {
  if (statusLabel.includes("병목 후보")) return "warn";
  if (statusLabel === "정상") return "ok";
  return "neutral";
}

export function HistoryScreen({
  code,
  onBackToStart,
}: {
  code: string;
  onBackToStart: () => void;
}) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;

    fetchHistoryEntries(code).then((result) => {
      if (cancelled) return;
      if (result.status === "ok") {
        setState({ kind: "loaded", entries: result.entries });
      } else {
        setState({ kind: "error" });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [code]);

  return (
    <main className="screen screen-history">
      <button className="link-button" onClick={onBackToStart}>
        ← 시작 화면
      </button>

      {state.kind === "loading" && (
        <section className="history-panel">
          <p>기록을 불러오는 중입니다…</p>
        </section>
      )}

      {state.kind === "error" && (
        <section className="history-panel">
          <p>기록을 불러오지 못했습니다. 다시 시도해보세요.</p>
        </section>
      )}

      {state.kind === "loaded" && state.entries.length === 0 && (
        <section className="history-panel history-empty">
          <p>아직 분석 기록이 없어요. 성능 분석을 먼저 진행해보세요.</p>
        </section>
      )}

      {state.kind === "loaded" &&
        state.entries.length > 0 &&
        (() => {
          const summary = summarizeHistory(state.entries);
          const rows = describeHistoryEntries(state.entries);

          return (
            <>
              <section className="history-summary-card">
                <h4>최근 내 PC, 어땠나요?</h4>
                <p>{summary.kind === "summary" ? summary.headline : ""}</p>
              </section>

              <section className="history-list">
                {rows.map((row, index) => (
                  <div className="history-row" key={`${row.measuredAt}-${index}`}>
                    <span className={`history-dot ${dotClassFor(row.statusLabel)}`} />
                    <span>{new Date(row.measuredAt).toLocaleString()}</span>
                    <span className="history-status">{row.statusLabel}</span>
                  </div>
                ))}
              </section>
            </>
          );
        })()}
    </main>
  );
}
