"use client";

import { useState } from "react";
import { AnalysisScreen } from "@/app/components/AnalysisScreen";
import { CompareScreen } from "@/app/components/CompareScreen";
import { HistoryScreen } from "@/app/components/HistoryScreen";
import { StartScreen } from "@/app/components/StartScreen";
import { fetchPerformanceStatus, type PerformanceStatus } from "@/lib/performance-status";

type View = "start" | "result" | "compare" | "history";

export default function Home() {
  const [view, setView] = useState<View>("start");
  const [code, setCode] = useState("");
  const [inputCode, setInputCode] = useState("");
  const [connectionCheck, setConnectionCheck] = useState<PerformanceStatus | null>(null);
  const [performanceStatus, setPerformanceStatus] = useState<PerformanceStatus | null>(null);
  const [previousStatus, setPreviousStatus] = useState<PerformanceStatus | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

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

  async function requestReanalysis() {
    setPreviousStatus(performanceStatus);
    setView("compare");
    setIsAnalyzing(true);
    const result = await fetchPerformanceStatus(inputCode);
    setPerformanceStatus(result);
    setIsAnalyzing(false);
    if (result.status === "received") {
      void recordHistoryEntry(inputCode);
    }
  }

  async function reanalyzeInCompare() {
    setIsAnalyzing(true);
    const result = await fetchPerformanceStatus(inputCode);
    setPerformanceStatus(result);
    setIsAnalyzing(false);
    if (result.status === "received") {
      void recordHistoryEntry(inputCode);
    }
  }

  if (view === "start") {
    return (
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
  }

  if (view === "history") {
    return <HistoryScreen code={inputCode} onBackToStart={() => setView("start")} />;
  }

  if (view === "compare") {
    return (
      <CompareScreen
        previousStatus={previousStatus}
        currentStatus={performanceStatus}
        isLoading={isAnalyzing}
        onReanalyze={reanalyzeInCompare}
        onBackToAnalysis={() => setView("result")}
      />
    );
  }

  return (
    <AnalysisScreen
      code={inputCode}
      status={performanceStatus}
      isLoading={isAnalyzing}
      onStatusUpdate={setPerformanceStatus}
      onRequestReanalysis={requestReanalysis}
      onBackToStart={() => setView("start")}
    />
  );
}
