"use client";

import { useState } from "react";
import {
  fetchPerformanceStatus,
  type DiskIoStatus,
  type OverloadStatus,
  type PerformanceStatus,
  type RamStatus,
} from "@/lib/performance-status";

const STATUS_TEXT: Record<Exclude<PerformanceStatus["status"], "received">, string> = {
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

const RAM_STATUS_TEXT: Record<RamStatus, string> = {
  "insufficient-data": "데이터 부족",
  normal: "RAM 병목 근거 없음",
  "bottleneck-candidate": "RAM 병목 후보",
};

const DISK_IO_STATUS_TEXT: Record<DiskIoStatus, string> = {
  "insufficient-data": "데이터 부족",
  normal: "Disk I/O 병목 근거 없음",
  "bottleneck-candidate": "Disk I/O 병목 후보",
};

function formatBytesAsGB(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}

function formatBytesAsMB(bytes: number): string {
  return (bytes / 1024 ** 2).toFixed(1);
}

export default function Home() {
  const [code, setCode] = useState("");
  const [inputCode, setInputCode] = useState("");
  const [performanceStatus, setPerformanceStatus] = useState<PerformanceStatus | null>(null);

  async function issueCode() {
    const res = await fetch("/api/code", { method: "POST" });
    if (!res.ok) {
      return;
    }
    const data = (await res.json()) as { code: string };
    setCode(data.code);
    setInputCode(data.code);
  }

  async function checkPerformanceStatus() {
    const result = await fetchPerformanceStatus(inputCode);
    setPerformanceStatus(result);
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
        <button onClick={checkPerformanceStatus}>성능 분석</button>
        {performanceStatus && (
          <div>
            {performanceStatus.status !== "received" ? (
              <p>상태: {STATUS_TEXT[performanceStatus.status]}</p>
            ) : (
              <>
                <section>
                  <h3>CPU</h3>
                  <p>상태: {OVERLOAD_STATUS_TEXT[performanceStatus.overloadStatus]}</p>
                  <p>CPU 사용률: {performanceStatus.cpuPercent.toFixed(1)}%</p>
                  <p>
                    마지막 측정:{" "}
                    {new Date(performanceStatus.measuredAt).toLocaleString()}
                  </p>
                  {performanceStatus.overloadStatus === "overload-candidate" &&
                    performanceStatus.overloadEvidence && (
                      <p>
                        판정 근거: 최고{" "}
                        {performanceStatus.overloadEvidence.maxCpuPercent.toFixed(1)}%,{" "}
                        {new Date(
                          performanceStatus.overloadEvidence.startedAt
                        ).toLocaleTimeString()}{" "}
                        ~{" "}
                        {new Date(
                          performanceStatus.overloadEvidence.endedAt
                        ).toLocaleTimeString()}{" "}
                        ({performanceStatus.overloadEvidence.durationSeconds.toFixed(1)}초 지속)
                      </p>
                    )}
                  {performanceStatus.overloadStatus === "overload-candidate" &&
                    performanceStatus.topProcess && (
                      <p>
                        관련 프로세스 후보: {performanceStatus.topProcess.name} (PID{" "}
                        {performanceStatus.topProcess.pid}, CPU{" "}
                        {performanceStatus.topProcess.cpuPercent.toFixed(1)}%)
                      </p>
                    )}
                </section>

                <section>
                  <h3>RAM</h3>
                  {performanceStatus.ram === null ? (
                    <p>상태: 데이터 부족</p>
                  ) : (
                    <>
                      <p>상태: {RAM_STATUS_TEXT[performanceStatus.ram.status]}</p>
                      {performanceStatus.ram.percent !== null && (
                        <p>RAM 사용률: {performanceStatus.ram.percent.toFixed(1)}%</p>
                      )}
                      {performanceStatus.ram.usedBytes !== null && (
                        <p>사용 중 메모리: {formatBytesAsGB(performanceStatus.ram.usedBytes)}GB</p>
                      )}
                      {performanceStatus.ram.availableBytes !== null && (
                        <p>
                          사용 가능한 메모리:{" "}
                          {formatBytesAsGB(performanceStatus.ram.availableBytes)}GB
                        </p>
                      )}
                      {performanceStatus.ram.status === "bottleneck-candidate" &&
                        performanceStatus.ram.evidence && (
                          <p>
                            판정 근거: 최고{" "}
                            {performanceStatus.ram.evidence.maxRamPercent.toFixed(1)}%,{" "}
                            {new Date(
                              performanceStatus.ram.evidence.startedAt
                            ).toLocaleTimeString()}{" "}
                            ~{" "}
                            {new Date(
                              performanceStatus.ram.evidence.endedAt
                            ).toLocaleTimeString()}{" "}
                            ({performanceStatus.ram.evidence.durationSeconds.toFixed(1)}초 지속)
                          </p>
                        )}
                      {performanceStatus.ram.status === "bottleneck-candidate" &&
                        performanceStatus.ram.topProcess && (
                          <p>
                            RAM 사용량이 높은 프로세스 후보: {performanceStatus.ram.topProcess.name}{" "}
                            (PID {performanceStatus.ram.topProcess.pid},{" "}
                            {formatBytesAsMB(performanceStatus.ram.topProcess.rss)}MB)
                          </p>
                        )}
                    </>
                  )}
                </section>

                <section>
                  <h3>Disk</h3>
                  {performanceStatus.disk === null ? (
                    <p>상태: 데이터 부족</p>
                  ) : (
                    <>
                      {performanceStatus.disk.capacity && (
                        <p>
                          용량 사용률: {performanceStatus.disk.capacity.percent.toFixed(1)}% (
                          {formatBytesAsGB(performanceStatus.disk.capacity.usedBytes)}GB /{" "}
                          {formatBytesAsGB(performanceStatus.disk.capacity.totalBytes)}GB)
                        </p>
                      )}
                      <p>I/O 상태: {DISK_IO_STATUS_TEXT[performanceStatus.disk.ioStatus]}</p>
                      {performanceStatus.disk.activePercent !== null && (
                        <p>Disk 활성 시간: {performanceStatus.disk.activePercent.toFixed(1)}%</p>
                      )}
                      {performanceStatus.disk.ioStatus === "bottleneck-candidate" &&
                        performanceStatus.disk.ioEvidence && (
                          <p>
                            판정 근거: 최고{" "}
                            {performanceStatus.disk.ioEvidence.maxDiskActivePercent.toFixed(1)}%,{" "}
                            {new Date(
                              performanceStatus.disk.ioEvidence.startedAt
                            ).toLocaleTimeString()}{" "}
                            ~{" "}
                            {new Date(
                              performanceStatus.disk.ioEvidence.endedAt
                            ).toLocaleTimeString()}{" "}
                            ({performanceStatus.disk.ioEvidence.durationSeconds.toFixed(1)}초 지속)
                          </p>
                        )}
                      {performanceStatus.disk.ioStatus === "bottleneck-candidate" &&
                        performanceStatus.disk.topIoProcess && (
                          <p>
                            Disk I/O가 높은 관련 프로세스 후보:{" "}
                            {performanceStatus.disk.topIoProcess.name} (PID{" "}
                            {performanceStatus.disk.topIoProcess.pid},{" "}
                            {(performanceStatus.disk.topIoProcess.bytesPerSec / 1024).toFixed(1)}
                            KB/s)
                          </p>
                        )}
                    </>
                  )}
                </section>
              </>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
