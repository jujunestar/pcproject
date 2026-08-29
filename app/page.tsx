"use client";

import { useState } from "react";
import { fetchCpuStatus, type CpuStatus, type OverloadStatus } from "@/lib/cpu-status";

const STATUS_TEXT: Record<Exclude<CpuStatus["status"], "received">, string> = {
  "invalid-code": "잘못된 연결 코드 형식",
  "no-data": "아직 수신된 데이터 없음",
  "fetch-failed": "조회 실패",
  "invalid-format": "데이터 형식을 확인할 수 없음",
};

const OVERLOAD_STATUS_TEXT: Record<OverloadStatus, string> = {
  "insufficient-data": "데이터 부족",
  normal: "CPU 과부하 근거 없음",
  "overload-candidate": "CPU 과부하 후보",
};

export default function Home() {
  const [code, setCode] = useState("");
  const [inputCode, setInputCode] = useState("");
  const [cpuStatus, setCpuStatus] = useState<CpuStatus | null>(null);

  async function issueCode() {
    const res = await fetch("/api/code", { method: "POST" });
    if (!res.ok) {
      return;
    }
    const data = (await res.json()) as { code: string };
    setCode(data.code);
    setInputCode(data.code);
  }

  async function checkCpuStatus() {
    const result = await fetchCpuStatus(inputCode);
    setCpuStatus(result);
  }

  return (
    <main className="hero">
      <h1>TracePC</h1>
      <p>느려진 순간을 추적해 PC 성능 저하의 원인을 찾습니다.</p>

      <section>
        <h2>1. Windows Agent 다운로드</h2>
        <a href="/downloads/TracePCAgent.exe" download>
          TracePCAgent.exe 다운로드
        </a>
      </section>

      <section>
        <h2>2. Agent 실행</h2>
        <p>다운로드한 TracePCAgent.exe를 더블클릭해 실행하세요.</p>
        <p>
          Windows가 &quot;알 수 없는 앱&quot; 경고를 표시하면 &quot;추가
          정보&quot; → &quot;실행&quot;을 눌러 계속 진행하세요.
        </p>
      </section>

      <section>
        <h2>3. 연결 코드 발급</h2>
        <button onClick={issueCode}>연결 코드 발급</button>
        {code && (
          <p>
            발급된 코드: <strong>{code}</strong>
          </p>
        )}
      </section>

      <section>
        <h2>4. Agent에 코드 입력</h2>
        <p>Agent 콘솔 창에 위에서 발급받은 6자리 코드를 입력하세요.</p>
      </section>

      <section>
        <h2>5. 성능 분석</h2>
        <div>
          <label>
            연결 코드{" "}
            <input
              value={inputCode}
              onChange={(e) => setInputCode(e.target.value)}
              placeholder="연결 코드"
            />
          </label>
        </div>
        <button onClick={checkCpuStatus}>성능 분석</button>
        {cpuStatus && (
          <div>
            {cpuStatus.status !== "received" ? (
              <p>상태: {STATUS_TEXT[cpuStatus.status]}</p>
            ) : (
              <>
                <p>상태: {OVERLOAD_STATUS_TEXT[cpuStatus.overloadStatus]}</p>
                <p>CPU 사용률: {cpuStatus.cpuPercent.toFixed(1)}%</p>
                <p>
                  마지막 측정:{" "}
                  {new Date(cpuStatus.measuredAt).toLocaleString()}
                </p>
                {cpuStatus.overloadStatus === "overload-candidate" &&
                  cpuStatus.overloadEvidence && (
                    <p>
                      판정 근거: 최고 {cpuStatus.overloadEvidence.maxCpuPercent.toFixed(1)}%,{" "}
                      {new Date(cpuStatus.overloadEvidence.startedAt).toLocaleTimeString()} ~{" "}
                      {new Date(cpuStatus.overloadEvidence.endedAt).toLocaleTimeString()} (
                      {cpuStatus.overloadEvidence.durationSeconds.toFixed(1)}초 지속)
                    </p>
                  )}
                {cpuStatus.overloadStatus === "overload-candidate" &&
                  cpuStatus.topProcess && (
                    <p>
                      관련 프로세스 후보: {cpuStatus.topProcess.name} (PID{" "}
                      {cpuStatus.topProcess.pid}, CPU{" "}
                      {cpuStatus.topProcess.cpuPercent.toFixed(1)}%)
                    </p>
                  )}
              </>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
