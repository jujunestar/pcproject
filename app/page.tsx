"use client";

import { useState } from "react";

export default function Home() {
  const [code, setCode] = useState("");
  const [inputCode, setInputCode] = useState("");
  const [value, setValue] = useState("");
  const [loadedValue, setLoadedValue] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  async function issueCode() {
    setStatus("");
    const res = await fetch("/api/code", { method: "POST" });
    if (!res.ok) {
      setStatus("연결 코드 발급 실패");
      return;
    }
    const data = (await res.json()) as { code: string };
    setCode(data.code);
    setInputCode(data.code);
  }

  async function saveValue() {
    setStatus("");
    const res = await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: inputCode, value }),
    });
    setStatus(res.ok ? "저장 완료" : "저장 실패");
  }

  async function loadValue() {
    setStatus("");
    const res = await fetch(`/api/data?code=${encodeURIComponent(inputCode)}`);
    if (!res.ok) {
      setStatus("조회 실패");
      return;
    }
    const data = (await res.json()) as { value: string | null };
    setLoadedValue(data.value);
    setStatus(data.value === null ? "저장된 값 없음" : "조회 완료");
  }

  return (
    <main className="hero">
      <h1>TracePC</h1>
      <p>느려진 순간을 추적해 PC 성능 저하의 원인을 찾습니다.</p>

      <section>
        <h2>연결 코드 발급</h2>
        <button onClick={issueCode}>연결 코드 발급</button>
        {code && (
          <p>
            발급된 코드: <strong>{code}</strong>
          </p>
        )}
      </section>

      <section>
        <h2>스켈레톤 검증 (테스트 값 저장/조회)</h2>
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
        <div>
          <label>
            테스트 값{" "}
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="저장할 값"
            />
          </label>
        </div>
        <button onClick={saveValue}>저장</button>
        <button onClick={loadValue}>조회</button>
        {loadedValue !== null && <p>조회된 값: {loadedValue}</p>}
        {status && <p>{status}</p>}
      </section>
    </main>
  );
}
