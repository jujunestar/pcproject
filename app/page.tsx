"use client";

import { useState } from "react";
import { AnalysisScreen } from "@/app/components/AnalysisScreen";
import { CompareScreen } from "@/app/components/CompareScreen";
import { StartScreen } from "@/app/components/StartScreen";
import { fetchPerformanceStatus, type PerformanceStatus } from "@/lib/performance-status";

type View = "start" | "result" | "compare";

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

  async function startAnalysis() {
    setView("result");
    setIsAnalyzing(true);
    const result = await fetchPerformanceStatus(inputCode);
    setPerformanceStatus(result);
    setIsAnalyzing(false);
  }

  async function requestReanalysis() {
    setPreviousStatus(performanceStatus);
    setView("compare");
    setIsAnalyzing(true);
    const result = await fetchPerformanceStatus(inputCode);
    setPerformanceStatus(result);
    setIsAnalyzing(false);
  }

  async function reanalyzeInCompare() {
    setIsAnalyzing(true);
    const result = await fetchPerformanceStatus(inputCode);
    setPerformanceStatus(result);
    setIsAnalyzing(false);
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
      />
    );
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
