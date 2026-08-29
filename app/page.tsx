"use client";

import { useState, type ReactNode } from "react";
import { AnalysisScreen } from "@/app/components/AnalysisScreen";
import { CompareScreen } from "@/app/components/CompareScreen";
import { HistoryScreen } from "@/app/components/HistoryScreen";
import { StartScreen } from "@/app/components/StartScreen";
import type { LiveSample } from "@/lib/live-samples";
import { fetchPerformanceStatus, type PerformanceStatus } from "@/lib/performance-status";

type View = "start" | "result" | "compare" | "history";

function AppShell({
  children,
}: {
  children: ReactNode;
}) {
  return <div className="app-frame">{children}</div>;
}

export default function Home() {
  const [view, setView] = useState<View>("start");
  const [code, setCode] = useState("");
  const [inputCode, setInputCode] = useState("");
  const [connectionCheck, setConnectionCheck] = useState<PerformanceStatus | null>(null);
  const [performanceStatus, setPerformanceStatus] = useState<PerformanceStatus | null>(null);
  const [previousStatus, setPreviousStatus] = useState<PerformanceStatus | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  // 화면②(AnalysisScreen)가 실제로 수집한 실시간 sample들. 화면③이
  // "조치 전" 그래프에 fake 데이터 없이 이 실측 시계열을 그대로
  // 재사용할 수 있도록 여기서 보관해둔다.
  const [analysisSamples, setAnalysisSamples] = useState<LiveSample[]>([]);

  async function issueCode() {
    const res = await fetch("/api/code", { method: "POST" });
    if (!res.ok) {
      return;
    }
    const data = (await res.json()) as { code: string };
    setCode(data.code);
    setInputCode(data.code);
  }

  async function checkConnection() {
    const result = await fetchPerformanceStatus(inputCode);
    setConnectionCheck(result);
  }

  async function recordHistoryEntry(analysisCode: string) {
    try {
      await fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: analysisCode }),
      });
    } catch {
      // 히스토리 기록은 부가 기능이라 실패해도 화면 표시에는 영향을 주지 않는다.
    }
  }

  async function startAnalysis() {
    setView("result");
    setIsAnalyzing(true);
    const result = await fetchPerformanceStatus(inputCode);
    setPerformanceStatus(result);
    setIsAnalyzing(false);
    if (result.status === "received") {
      void recordHistoryEntry(inputCode);
    }
  }

  function requestReanalysis() {
    setPreviousStatus(performanceStatus);
    setView("compare");
  }

  // 화면③이 "새 measuredAt이 실제로 도착했다"고 확인했을 때만 호출된다
  // (CompareScreen 내부의 hasNewMeasurement 판정 참고) — 그 순간에는
  // 사용자가 실제로 재분석을 수행한 것이므로 히스토리에도 기록한다.
  // 2초 폴링(화면②)과 달리 여기는 무조건 매번 기록해도 스팸이 되지
  // 않는다 — 애초에 새 값이 확인됐을 때만 호출되기 때문이다.
  function handleCompareStatusUpdate(status: PerformanceStatus) {
    setPerformanceStatus(status);
    if (status.status === "received") {
      void recordHistoryEntry(inputCode);
    }
  }

  let screen: React.ReactNode;

  if (view === "start") {
    screen = (
      <StartScreen
        code={code}
        inputCode={inputCode}
        connectionCheck={connectionCheck}
        onInputCodeChange={setInputCode}
        onIssueCode={issueCode}
        onCheckConnection={checkConnection}
        onStartAnalysis={startAnalysis}
        onViewHistory={() => setView("history")}
      />
    );
  } else if (view === "history") {
    screen = <HistoryScreen code={inputCode} onBackToStart={() => setView("start")} />;
  } else if (view === "compare") {
    screen = (
      <CompareScreen
        code={inputCode}
        previousStatus={previousStatus}
        previousSamples={analysisSamples}
        onStatusUpdate={handleCompareStatusUpdate}
        onBackToAnalysis={() => setView("result")}
      />
    );
  } else {
    screen = (
      <AnalysisScreen
        code={inputCode}
        status={performanceStatus}
        isLoading={isAnalyzing}
        onStatusUpdate={setPerformanceStatus}
        onSamplesChange={setAnalysisSamples}
        onRequestReanalysis={requestReanalysis}
        onBackToStart={() => setView("start")}
      />
    );
  }

  return <AppShell>{screen}</AppShell>;
}
