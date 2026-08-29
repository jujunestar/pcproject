# Analysis History Dashboard (화면④) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 4th screen showing a plain-language summary card + timeline of a code's past analyses, backed by a new short-retention Redis history list, without touching any existing CPU/RAM/Disk/comprehensive-diagnosis judgment logic.

**Architecture:** Extend the existing Upstash Redis (already used for `session:{code}`) with a capped, 7-day `history:{code}` list. A new `POST /api/history` endpoint copies whatever is currently in `session:{code}` into that list (never trusts a client-supplied value, avoiding payload-shape drift). A new `GET /api/history` endpoint reads it back. Three specific user-initiated fetch call sites in `app/page.tsx` — never the 2-second live-graph polling tick — trigger the recording, fire-and-forget. A new pure `lib/history-summary.ts` reuses the existing, unmodified `evaluateComprehensiveDiagnosis` to build the summary/timeline text.

**Tech Stack:** Next.js App Router (Route Handlers), TypeScript, Upstash Redis (`@upstash/redis`, already a dependency — no new packages), Vitest.

**Spec:** `docs/slices/analysis-history-dashboard.md` — read it alongside this plan; this plan implements it task-by-task and does not repeat its rationale.

## Global Constraints

- No new npm dependencies (spec: "새 데이터베이스나 새 의존성은 추가하지 않는다").
- No GPU/network/CPU-temperature features (PRD.md, CLAUDE.md).
- Do not modify `agent/*.py`, `lib/comprehensive-diagnosis.ts`, `lib/live-samples.ts`, `lib/polling-controller.ts`, or any CPU/RAM/Disk judgment threshold/logic — this slice only adds new files and additive wiring.
- History is recorded ONLY at `startAnalysis`, `requestReanalysis`, `reanalyzeInCompare` in `app/page.tsx` — never at `checkConnection`, never inside `AnalysisScreen`'s 2-second polling tick.
- `history:{code}` retention: max 20 entries, TTL 7 days (604800 seconds), refreshed on every write.
- Screens ①②③ keep their existing grayscale styling untouched. Only the new screen④ (`HistoryScreen`) uses the "B. 부드러운 카드" light/soft styling approved in brainstorming (light gray-blue background `#f4f6fb`, white cards, soft shadow, green/amber/gray status dots — no dark mode, per CLAUDE.md).
- **Commit cadence override (per CLAUDE.md "커밋은 기능 단위 하나씩 한다"):** do NOT commit after each task. Run the verification steps in every task, but create exactly **one** git commit for the whole slice, in Task 8, after full regression passes.
- Every new pure-logic file gets tests first (TDD), matching this repo's existing convention (see `lib/comprehensive-diagnosis.test.ts`, `lib/comparison.test.ts` for style). New Next.js Route Handlers do NOT get automated tests, matching this repo's existing convention for `app/api/data/route.ts` — they're verified via production E2E curl checks in Task 8 instead.

---

### Task 1: Shared Redis helpers + refactor existing route to use them

**Files:**
- Create: `lib/redis-client.ts`
- Create: `lib/redis-keys.ts`
- Modify: `app/api/data/route.ts` (replace its inline `Redis` client + `keyFor` with the new shared modules — no behavior change)

**Interfaces:**
- Produces: `redis` (a configured `Redis` instance) from `lib/redis-client.ts`; `sessionKeyFor(code: string): string` and `historyKeyFor(code: string): string` from `lib/redis-keys.ts`. Tasks 4 and later import these.

- [ ] **Step 1: Create `lib/redis-client.ts`**

```ts
import { Redis } from "@upstash/redis";

export const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
  automaticDeserialization: false,
});
```

- [ ] **Step 2: Create `lib/redis-keys.ts`**

```ts
export function sessionKeyFor(code: string): string {
  return `session:${code}`;
}

export function historyKeyFor(code: string): string {
  return `history:${code}`;
}
```

- [ ] **Step 3: Replace the contents of `app/api/data/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis-client";
import { sessionKeyFor } from "@/lib/redis-keys";

// 스켈레톤 검증용 TTL. 실제 세션 수명은 아직 정하지 않았다.
const TTL_SECONDS = 60 * 60;

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { code?: string; value?: string };
  const { code, value } = body;

  if (!code) {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }
  if (typeof value !== "string") {
    return NextResponse.json({ error: "value is required" }, { status: 400 });
  }

  await redis.set(sessionKeyFor(code), value, { ex: TTL_SECONDS });
  return NextResponse.json({ ok: true });
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }

  const value = await redis.get<string>(sessionKeyFor(code));
  return NextResponse.json({ value: value ?? null });
}
```

- [ ] **Step 4: Verify no regression**

Run: `npm run typecheck && npm test && npm run build`
Expected: all pass (this is a behavior-preserving refactor — `app/api/data/route.ts`'s request/response shape is byte-identical to before).

---

### Task 2: `lib/history-summary.ts` (TDD)

**Files:**
- Create: `lib/history-summary.test.ts`
- Create: `lib/history-summary.ts`

**Interfaces:**
- Consumes: `evaluateComprehensiveDiagnosis(status)` from `lib/comprehensive-diagnosis.ts` (existing, unmodified) and `PerformanceStatus` type from `lib/performance-status.ts` (existing).
- Produces: `export type HistoryEntry = { measuredAt: string; statusLabel: string }`, `export type HistorySummary = { kind: "empty" } | { kind: "summary"; totalCount: number; candidateCount: number; topResourceLabel: string | null; headline: string }`, `export function describeHistoryEntries(statuses: ReceivedStatus[]): HistoryEntry[]`, `export function summarizeHistory(statuses: ReceivedStatus[]): HistorySummary`. Tasks 5 and 6 consume these.

- [ ] **Step 1: Write the failing test file `lib/history-summary.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { describeHistoryEntries, summarizeHistory } from "./history-summary";
import type { PerformanceStatus } from "./performance-status";

type Received = Extract<PerformanceStatus, { status: "received" }>;

function baseReceived(overrides: Partial<Received> = {}): Received {
  return {
    status: "received",
    cpuPercent: 20.0,
    measuredAt: "2026-08-29T05:00:00.000Z",
    overloadStatus: "normal",
    overloadEvidence: null,
    topProcess: null,
    ram: {
      percent: 40.0,
      usedBytes: 1000,
      availableBytes: 2000,
      status: "normal",
      evidence: null,
      topProcess: null,
    },
    disk: {
      capacity: { totalBytes: 100, usedBytes: 50, freeBytes: 50, percent: 50.0 },
      activePercent: 1.0,
      ioStatus: "normal",
      ioEvidence: null,
      topIoProcess: null,
    },
    ...overrides,
  };
}

function ramCandidate(measuredAt: string): Received["ram"] {
  return {
    percent: 94.0,
    usedBytes: 1000,
    availableBytes: 100,
    status: "bottleneck-candidate",
    evidence: {
      startedAt: measuredAt,
      endedAt: measuredAt,
      durationSeconds: 6.0,
      maxRamPercent: 94.0,
    },
    topProcess: { pid: 5336, name: "powershell.exe", rss: 7346740429, memoryPercent: 40 },
  };
}

function diskCandidate(measuredAt: string): Received["disk"] {
  return {
    capacity: { totalBytes: 100, usedBytes: 50, freeBytes: 50, percent: 50.0 },
    activePercent: 132.5,
    ioStatus: "bottleneck-candidate",
    ioEvidence: {
      startedAt: measuredAt,
      endedAt: measuredAt,
      durationSeconds: 6.0,
      maxDiskActivePercent: 132.5,
    },
    topIoProcess: { pid: 8821, name: "chrome.exe", bytesPerSec: 524698.9 },
  };
}

describe("summarizeHistory", () => {
  it("빈 배열이면 empty를 반환한다", () => {
    expect(summarizeHistory([])).toEqual({ kind: "empty" });
  });

  it("기록이 1개면 '가장 최근 분석' 형태의 headline을 만든다", () => {
    const status = baseReceived({ ram: ramCandidate("2026-08-29T05:00:00.000Z") });

    const result = summarizeHistory([status]);

    expect(result).toMatchObject({
      kind: "summary",
      totalCount: 1,
      candidateCount: 1,
      topResourceLabel: "RAM",
      headline: "가장 최근 분석: RAM 병목 후보",
    });
  });

  it("5개 중 3개가 RAM 병목 후보면 정확한 문장을 만든다", () => {
    const statuses = [
      baseReceived({ ram: ramCandidate("t1") }),
      baseReceived(),
      baseReceived({ ram: ramCandidate("t3") }),
      baseReceived(),
      baseReceived({ ram: ramCandidate("t5") }),
    ];

    const result = summarizeHistory(statuses);

    expect(result).toMatchObject({
      kind: "summary",
      totalCount: 5,
      candidateCount: 3,
      topResourceLabel: "RAM",
      headline: "최근 5번 중 3번 RAM 병목 후보 감지됨",
    });
  });

  it("후보가 0건이면 모두 정상 문구를 만든다", () => {
    const statuses = [baseReceived(), baseReceived(), baseReceived()];

    const result = summarizeHistory(statuses);

    expect(result).toMatchObject({
      kind: "summary",
      candidateCount: 0,
      topResourceLabel: null,
      headline: "측정한 범위에서 최근 3번 모두 병목 후보가 발견되지 않았습니다",
    });
  });

  it("RAM과 Disk가 동률로 가장 자주 등장하면 둘 다 표시한다", () => {
    const statuses = [
      baseReceived({ ram: ramCandidate("t1") }),
      baseReceived({ disk: diskCandidate("t2") }),
    ];

    const result = summarizeHistory(statuses);

    expect(result).toMatchObject({ topResourceLabel: "RAM, Disk" });
  });
});

describe("describeHistoryEntries", () => {
  it("정상/단일 후보/동시 후보/데이터 부족 네 가지 라벨을 각각 만든다", () => {
    const normal = baseReceived({ measuredAt: "t-normal" });
    const singleCandidate = baseReceived({ measuredAt: "t-single", ram: ramCandidate("t-single") });
    const tiedCandidate = baseReceived({
      measuredAt: "t-tied",
      ram: ramCandidate("t-tied"),
      disk: diskCandidate("t-tied"),
    });
    const insufficient = baseReceived({
      measuredAt: "t-insufficient",
      overloadStatus: "insufficient-data",
      ram: null,
      disk: null,
    });

    const result = describeHistoryEntries([normal, singleCandidate, tiedCandidate, insufficient]);

    expect(result).toEqual([
      { measuredAt: "t-normal", statusLabel: "정상" },
      { measuredAt: "t-single", statusLabel: "RAM 병목 후보" },
      { measuredAt: "t-tied", statusLabel: "RAM, Disk 동시 병목 후보" },
      { measuredAt: "t-insufficient", statusLabel: "데이터 부족" },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/history-summary.test.ts`
Expected: FAIL with "Cannot find module './history-summary'"

- [ ] **Step 3: Create `lib/history-summary.ts`**

```ts
import { evaluateComprehensiveDiagnosis } from "./comprehensive-diagnosis";
import type { PerformanceStatus } from "./performance-status";

type ReceivedStatus = Extract<PerformanceStatus, { status: "received" }>;
type ResourceKey = "cpu" | "ram" | "disk";

export type HistoryEntry = {
  measuredAt: string;
  statusLabel: string;
};

export type HistorySummary =
  | { kind: "empty" }
  | {
      kind: "summary";
      totalCount: number;
      candidateCount: number;
      topResourceLabel: string | null;
      headline: string;
    };

const RESOURCE_ORDER: ResourceKey[] = ["cpu", "ram", "disk"];
const RESOURCE_LABEL: Record<ResourceKey, string> = { cpu: "CPU", ram: "RAM", disk: "Disk" };

function describeEntry(status: ReceivedStatus): HistoryEntry {
  const diagnosis = evaluateComprehensiveDiagnosis(status);
  let statusLabel: string;

  if (diagnosis.kind === "insufficient-data") {
    statusLabel = "데이터 부족";
  } else if (diagnosis.kind === "no-candidate") {
    statusLabel = "정상";
  } else if (diagnosis.kind === "single-primary") {
    statusLabel = `${diagnosis.primary.label} 병목 후보`;
  } else {
    statusLabel = `${diagnosis.candidates.map((c) => c.label).join(", ")} 동시 병목 후보`;
  }

  return { measuredAt: status.measuredAt, statusLabel };
}

export function describeHistoryEntries(statuses: ReceivedStatus[]): HistoryEntry[] {
  return statuses.map(describeEntry);
}

function candidateResourcesOf(status: ReceivedStatus): ResourceKey[] {
  const diagnosis = evaluateComprehensiveDiagnosis(status);
  if (diagnosis.kind === "single-primary") {
    return [diagnosis.primary.resource, ...diagnosis.secondaryCandidates.map((c) => c.resource)];
  }
  if (diagnosis.kind === "tied-primary") {
    return diagnosis.candidates.map((c) => c.resource);
  }
  return [];
}

export function summarizeHistory(statuses: ReceivedStatus[]): HistorySummary {
  if (statuses.length === 0) {
    return { kind: "empty" };
  }

  const totalCount = statuses.length;
  const entries = describeHistoryEntries(statuses);

  const counts: Record<ResourceKey, number> = { cpu: 0, ram: 0, disk: 0 };
  let candidateCount = 0;
  for (const status of statuses) {
    const resources = candidateResourcesOf(status);
    if (resources.length > 0) candidateCount += 1;
    for (const resource of resources) {
      counts[resource] += 1;
    }
  }

  const maxCount = Math.max(...RESOURCE_ORDER.map((r) => counts[r]));
  const topResources = RESOURCE_ORDER.filter((r) => maxCount > 0 && counts[r] === maxCount);
  const topResourceLabel = topResources.length > 0 ? topResources.map((r) => RESOURCE_LABEL[r]).join(", ") : null;

  const headline =
    totalCount === 1
      ? `가장 최근 분석: ${entries[0].statusLabel}`
      : candidateCount === 0
        ? `측정한 범위에서 최근 ${totalCount}번 모두 병목 후보가 발견되지 않았습니다`
        : `최근 ${totalCount}번 중 ${candidateCount}번 ${topResourceLabel} 병목 후보 감지됨`;

  return { kind: "summary", totalCount, candidateCount, topResourceLabel, headline };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/history-summary.test.ts`
Expected: PASS, 6 tests

---

### Task 3: `lib/performance-status.ts` — export `parseValue`, add `fetchHistoryEntries` (TDD)

**Files:**
- Modify: `lib/performance-status.ts` (add `export` to the existing `parseValue` function; add new `fetchHistoryEntries` function — do not change any existing exported behavior)
- Modify: `lib/performance-status.test.ts` (add new tests only)

**Interfaces:**
- Consumes: nothing new (uses the file's own existing `CODE_PATTERN` and `parseValue`).
- Produces: `export function parseValue(value: string): PerformanceStatus` (was private, now exported — Task 4's route handler imports this); `export function fetchHistoryEntries(code: string): Promise<{status:"invalid-code"} | {status:"fetch-failed"} | {status:"ok"; entries: Array<Extract<PerformanceStatus,{status:"received"}>>}>` (Task 5's `HistoryScreen` imports this).

- [ ] **Step 1: Write the failing tests — append to `lib/performance-status.test.ts`**

```ts
describe("fetchHistoryEntries", () => {
  it("올바른 코드면 /api/history를 조회해 파싱 가능한 항목만 반환한다", async () => {
    const valid = JSON.stringify(baseCpuFields);
    const corrupt = "not json{";
    const missingField = JSON.stringify({ ...baseCpuFields, cpuPercent: undefined });

    mockFetchOnce({ ok: true, json: async () => ({ entries: [valid, corrupt, missingField] }) });

    const result = await fetchHistoryEntries("ABC123");

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].cpuPercent).toBe(42.3);
    }
  });

  it("6자리 영숫자가 아닌 코드는 조회 없이 거부한다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchHistoryEntries("ABCDE");

    expect(result).toEqual({ status: "invalid-code" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("네트워크 오류가 발생하면 조회 실패 상태가 된다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await fetchHistoryEntries("ABC123");

    expect(result).toEqual({ status: "fetch-failed" });
  });
});
```

(This uses the same `mockFetchOnce`, `baseCpuFields`, and `vi`/`describe`/`it`/`expect` already imported at the top of `lib/performance-status.test.ts` — no new imports needed except adding `fetchHistoryEntries` to the existing `import { fetchPerformanceStatus } from "./performance-status";` line, which becomes `import { fetchHistoryEntries, fetchPerformanceStatus } from "./performance-status";`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/performance-status.test.ts`
Expected: FAIL — `fetchHistoryEntries` is not exported / not defined

- [ ] **Step 3: Modify `lib/performance-status.ts`**

Find this line (the existing private parse function):

```ts
function parseValue(value: string): PerformanceStatus {
```

Replace with:

```ts
export function parseValue(value: string): PerformanceStatus {
```

Then add this new function after the existing `fetchPerformanceStatus` function (at the end of the file):

```ts
export async function fetchHistoryEntries(code: string): Promise<
  | { status: "invalid-code" }
  | { status: "fetch-failed" }
  | { status: "ok"; entries: Array<Extract<PerformanceStatus, { status: "received" }>> }
> {
  if (!CODE_PATTERN.test(code)) {
    return { status: "invalid-code" };
  }

  let response: Response;
  try {
    response = await fetch(`/api/history?code=${encodeURIComponent(code)}`);
  } catch {
    return { status: "fetch-failed" };
  }

  if (!response.ok) {
    return { status: "fetch-failed" };
  }

  const body = (await response.json()) as { entries: string[] };
  const entries = body.entries
    .map((raw) => parseValue(raw))
    .filter(
      (parsed): parsed is Extract<PerformanceStatus, { status: "received" }> =>
        parsed.status === "received"
    );

  return { status: "ok", entries };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/performance-status.test.ts`
Expected: PASS, all existing tests plus the 3 new ones

---

### Task 4: `app/api/history/route.ts` (new endpoints)

**Files:**
- Create: `app/api/history/route.ts`

**Interfaces:**
- Consumes: `redis` from `lib/redis-client.ts` (Task 1), `sessionKeyFor`/`historyKeyFor` from `lib/redis-keys.ts` (Task 1), `parseValue` from `lib/performance-status.ts` (Task 3, now exported).
- Produces: `POST /api/history` (request `{code: string}`, response `{ok: true}` or 400 `{error: string}`); `GET /api/history?code=...` (response `{entries: string[]}`). Task 3's `fetchHistoryEntries` and `app/page.tsx`'s `recordHistoryEntry` (Task 7) call these over HTTP.

- [ ] **Step 1: Create `app/api/history/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { parseValue } from "@/lib/performance-status";
import { redis } from "@/lib/redis-client";
import { historyKeyFor, sessionKeyFor } from "@/lib/redis-keys";

const HISTORY_MAX_ENTRIES = 20;
const HISTORY_TTL_SECONDS = 60 * 60 * 24 * 7;

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { code?: string };
  const { code } = body;

  if (!code) {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }

  const raw = await redis.get<string>(sessionKeyFor(code));
  if (typeof raw !== "string") {
    return NextResponse.json({ error: "no current data to record" }, { status: 400 });
  }

  const parsed = parseValue(raw);
  if (parsed.status !== "received") {
    return NextResponse.json({ error: "current data is not in a recordable state" }, { status: 400 });
  }

  const key = historyKeyFor(code);
  await redis.lpush(key, raw);
  await redis.ltrim(key, 0, HISTORY_MAX_ENTRIES - 1);
  await redis.expire(key, HISTORY_TTL_SECONDS);

  return NextResponse.json({ ok: true });
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }

  const entries = await redis.lrange<string>(historyKeyFor(code), 0, -1);
  return NextResponse.json({ entries: entries ?? [] });
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck`
Expected: PASS (no automated test for this route, matching this repo's existing convention for `app/api/data/route.ts` — verified via production E2E in Task 8)

---

### Task 5: `app/components/HistoryScreen.tsx` + CSS + smoke test

**Files:**
- Create: `app/components/HistoryScreen.tsx`
- Modify: `app/globals.css` (append new `.screen-history`/`.history-*` rules — do not change any existing rule)
- Modify: `app/components/screens.smoke.test.tsx` (add one new `describe` block)

**Interfaces:**
- Consumes: `fetchHistoryEntries` from `lib/performance-status.ts` (Task 3), `summarizeHistory`/`describeHistoryEntries` from `lib/history-summary.ts` (Task 2).
- Produces: `export function HistoryScreen({ code, onBackToStart }: { code: string; onBackToStart: () => void })`. Task 7's `app/page.tsx` renders this.

- [ ] **Step 1: Create `app/components/HistoryScreen.tsx`**

```tsx
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
```

- [ ] **Step 2: Append new CSS rules to the end of `app/globals.css`**

```css
.screen-history {
  background: #f4f6fb;
}

.history-panel {
  background: #fff;
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 1px 3px rgba(30, 41, 59, 0.08);
}

.history-empty {
  text-align: center;
  color: #64748b;
}

.history-summary-card {
  background: #fff;
  border-radius: 12px;
  padding: 14px 16px;
  box-shadow: 0 1px 3px rgba(30, 41, 59, 0.08);
}

.history-summary-card h4 {
  font-size: 0.95rem;
  margin: 0 0 4px;
  color: #1e293b;
}

.history-summary-card p {
  font-size: 0.85rem;
  margin: 0;
  color: #64748b;
}

.history-list {
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(30, 41, 59, 0.08);
}

.history-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  font-size: 0.85rem;
  color: #334155;
  border-top: 1px solid #eef1f6;
}

.history-row:first-child {
  border-top: none;
}

.history-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.history-dot.ok {
  background: #22c55e;
}

.history-dot.warn {
  background: #f59e0b;
}

.history-dot.neutral {
  background: #94a3b8;
}

.history-status {
  margin-left: auto;
  font-weight: 600;
}

.link-button:disabled {
  color: #bbb;
  cursor: not-allowed;
}
```

- [ ] **Step 3: Add a smoke test — append this new `describe` block to `app/components/screens.smoke.test.tsx`** (before the final closing of the file; it needs `HistoryScreen` imported — add `import { HistoryScreen } from "./HistoryScreen";` next to the other component imports at the top of the file)

```tsx
describe("HistoryScreen 와이어프레임 상태", () => {
  const noop = () => {};

  it("loading 상태를 렌더링한다 (SSR은 useEffect를 실행하지 않으므로 이 상태만 확인 가능 — populated/empty/error는 production 수동 확인)", () => {
    const html = renderToStaticMarkup(<HistoryScreen code="ABC123" onBackToStart={noop} />);
    expect(html).toContain("기록을 불러오는 중입니다");
  });
});
```

- [ ] **Step 4: Run the tests, typecheck, and build**

Run: `npm test && npm run typecheck && npm run build`
Expected: all PASS. New smoke test count increases by 1.

---

### Task 6: `app/components/StartScreen.tsx` — add "히스토리 보기" link

**Files:**
- Modify: `app/components/StartScreen.tsx`
- Modify: `app/components/screens.smoke.test.tsx` (add `onViewHistory={noop}` to the 3 existing `<StartScreen ... />` calls in the "StartScreen 와이어프레임 상태" describe block)

**Interfaces:**
- Produces: `StartScreen` now requires a new prop `onViewHistory: () => void`. Task 7's `app/page.tsx` must pass it.

- [ ] **Step 1: Modify `app/components/StartScreen.tsx` — add the new prop to the function signature**

Find:

```tsx
export function StartScreen({
  code,
  inputCode,
  connectionCheck,
  onInputCodeChange,
  onIssueCode,
  onCheckConnection,
  onStartAnalysis,
}: {
  code: string;
  inputCode: string;
  connectionCheck: PerformanceStatus | null;
  onInputCodeChange: (value: string) => void;
  onIssueCode: () => void;
  onCheckConnection: () => void;
  onStartAnalysis: () => void;
}) {
```

Replace with:

```tsx
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
```

- [ ] **Step 2: Add the link — find this block**

```tsx
      <section className="panel panel-cta">
        <h2>5. 성능 분석 시작</h2>
        <button className="button button-primary" onClick={onStartAnalysis} disabled={inputCode === ""}>
          성능 분석 시작
        </button>
      </section>
```

Replace with:

```tsx
      <section className="panel panel-cta">
        <h2>5. 성능 분석 시작</h2>
        <button className="button button-primary" onClick={onStartAnalysis} disabled={inputCode === ""}>
          성능 분석 시작
        </button>
        <button className="link-button" onClick={onViewHistory} disabled={inputCode === ""}>
          히스토리 보기
        </button>
      </section>
```

- [ ] **Step 3: Update the 3 existing `<StartScreen ... />` calls in `app/components/screens.smoke.test.tsx`'s "StartScreen 와이어프레임 상태" describe block** — add `onViewHistory={noop}` as a new prop line to each of the 3 calls (they currently end with `onStartAnalysis={noop}` — add the new line right after it in each of the 3 test cases: "초기 상태를 렌더링한다", "연결 완료 상태를 렌더링한다", "연결 실패 상태를 렌더링한다").

Example for the first one — find:

```tsx
      <StartScreen
        code=""
        inputCode=""
        connectionCheck={null}
        onInputCodeChange={noop}
        onIssueCode={noop}
        onCheckConnection={noop}
        onStartAnalysis={noop}
      />
```

Replace with:

```tsx
      <StartScreen
        code=""
        inputCode=""
        connectionCheck={null}
        onInputCodeChange={noop}
        onIssueCode={noop}
        onCheckConnection={noop}
        onStartAnalysis={noop}
        onViewHistory={noop}
      />
```

Apply the same `onViewHistory={noop}` addition (right after `onStartAnalysis={noop}`) to the other two `<StartScreen ... />` calls in that same describe block.

- [ ] **Step 4: Run the tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS (without this step, TypeScript would fail with "Property 'onViewHistory' is missing")

---

### Task 7: `app/page.tsx` — wire the `"history"` view and history recording

**Files:**
- Modify: `app/page.tsx` (full replacement shown below)

**Interfaces:**
- Consumes: `HistoryScreen` (Task 5), `StartScreen`'s new `onViewHistory` prop (Task 6).
- Produces: the complete, wired application — nothing downstream depends on this file.

- [ ] **Step 1: Replace the full contents of `app/page.tsx`**

```tsx
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
```

- [ ] **Step 2: Run the full local verification**

Run: `npm test && npm run typecheck && npm run build`
Expected: all PASS

---

### Task 8: Full verification, single commit, push, deploy, production E2E

**Files:** none (verification and git/deploy only)

- [ ] **Step 1: Run the full test suite, typecheck, and build one more time from a clean state**

Run: `npm test && npm run typecheck && npm run build`
Expected: all PASS

- [ ] **Step 2: Run the Python Agent regression suite (confirms this slice touched nothing under `agent/`)**

Run: `cd agent && python -m pytest -q`
Expected: all 123 tests PASS (same count as before this slice — this plan never touches `agent/*.py`)

- [ ] **Step 3: Boot the production build locally and confirm it serves**

Run: `npm run start -- -p 3102 &` then `sleep 3 && curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3102/ && curl -s http://localhost:3102/ | grep -o '히스토리 보기'`, then stop the server.
Expected: `HTTP 200` and the grep finds `히스토리 보기` in the server-rendered start screen.

- [ ] **Step 4: Stage and commit everything from this slice in one commit**

```bash
git add lib/redis-client.ts lib/redis-keys.ts lib/history-summary.ts lib/history-summary.test.ts \
  lib/performance-status.ts lib/performance-status.test.ts \
  app/api/data/route.ts app/api/history/route.ts \
  app/components/HistoryScreen.tsx app/components/StartScreen.tsx app/components/screens.smoke.test.tsx \
  app/page.tsx app/globals.css \
  docs/slices/analysis-history-dashboard.md docs/superpowers/plans/2026-08-29-analysis-history-dashboard.md

git commit -m "$(cat <<'EOF'
Add analysis history dashboard (screen④)

New history:{code} Redis list (7-day TTL, capped at 20 entries),
recorded only at the three user-initiated analysis actions
(startAnalysis, requestReanalysis, reanalyzeInCompare in
app/page.tsx) — never at connection checks and never at the 2s
live-graph polling tick, per docs/slices/analysis-history-dashboard.md.

POST /api/history takes only {code} and copies whatever is currently
in session:{code} server-side, rather than trusting a client-resent
value, to avoid a payload-shape mismatch between the raw Agent
payload and the parsed PerformanceStatus shape.

lib/history-summary.ts (summarizeHistory, describeHistoryEntries) is
new, TDD'd, pure logic that reuses evaluateComprehensiveDiagnosis
unchanged — no new judgment logic. Screens ①②③ keep their existing
grayscale styling; only the new HistoryScreen uses the light
card-based style approved in brainstorming.

lib/redis-client.ts and lib/redis-keys.ts extract the Redis client
and key-naming already used by app/api/data/route.ts so the new
app/api/history/route.ts can share them without duplication —
app/api/data/route.ts's behavior is unchanged.
EOF
)"
```

- [ ] **Step 5: Push**

Run: `git push origin main`

- [ ] **Step 6: Wait for the Vercel deploy, then verify the new API endpoints in production**

```bash
CODE=$(curl -s -X POST https://pcproject-tau.vercel.app/api/code | python -c "import sys,json; print(json.load(sys.stdin)['code'])")

# Seed session:{code} with a valid "received" payload, same shape used elsewhere in this project
curl -s -X POST https://pcproject-tau.vercel.app/api/data -H "Content-Type: application/json" -d "{\"code\":\"$CODE\",\"value\":\"{\\\"cpuPercent\\\": 20.0, \\\"measuredAt\\\": \\\"2026-08-29T07:00:00.000Z\\\", \\\"overloadStatus\\\": \\\"normal\\\", \\\"overloadEvidence\\\": null, \\\"topProcess\\\": null}\"}"

# Record it into history
curl -s -X POST https://pcproject-tau.vercel.app/api/history -H "Content-Type: application/json" -d "{\"code\":\"$CODE\"}"

# Read it back
curl -s "https://pcproject-tau.vercel.app/api/history?code=$CODE"
```

Expected: the `/api/history` POST returns `{"ok":true}`, and the GET returns `{"entries":["...the exact JSON string posted to /api/data..."]}`.

- [ ] **Step 7: Confirm the new screen shipped in the production JS bundle**

```bash
curl -s https://pcproject-tau.vercel.app/ -o /tmp/index.html
for path in $(grep -oE '/_next/static/[A-Za-z0-9_/.\-]*\.js' /tmp/index.html | sort -u); do
  curl -s "https://pcproject-tau.vercel.app${path}" -o "/tmp/$(basename "$path")"
done
grep -l "아직 분석 기록이 없어요" /tmp/*.js
grep -l "최근 내 PC, 어땠나요" /tmp/*.js
```

Expected: both greps find a match in one of the downloaded chunk files.

- [ ] **Step 8: Hand off the remaining manual checks to the user**

The E2E curl checks above prove the API and bundle are correct, but confirming completion condition 5 ("2초 폴링 중에는 히스토리가 늘어나지 않는다") and the full click-through experience needs a real Agent + browser, which this session cannot automate. Point the user at `docs/slices/analysis-history-dashboard.md`'s "production 수동 확인 절차" section (5 steps: repeat "성능 분석 시작" a few times, open 화면④, check the timeline/summary match, sit on 화면② through a polling cycle and confirm the count didn't change, issue a fresh code and confirm the empty state) and report the plan is otherwise done.
