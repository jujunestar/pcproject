// @vitest-environment jsdom
//
// 이 파일만 jsdom 환경을 쓴다(다른 90여 개 테스트는 그대로 node 환경).
// useEffect의 의존성 배열 문제는 react-dom/server(SSR)로는 재현할 수
// 없다 — SSR은 effect를 아예 실행하지 않기 때문이다. 실제 마운트/재렌더링을
// 관찰하려면 진짜 DOM + react-dom/client가 필요해서, 이 버그 재현
// 전용으로만 jsdom을 devDependency로 추가했다.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompareScreen } from "./CompareScreen";
import type { PerformanceStatus } from "@/lib/performance-status";

type Received = Extract<PerformanceStatus, { status: "received" }>;

function baseReceived(overrides: Partial<Received> = {}): Received {
  return {
    status: "received",
    cpuPercent: 20.0,
    measuredAt: "2026-08-29T05:00:00.000Z",
    overloadStatus: "normal",
    overloadEvidence: null,
    topProcess: null,
    ram: null,
    disk: null,
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// page.tsx의 실제 패턴을 그대로 재현한다: handleCompareStatusUpdate는
// useCallback 없이 컴포넌트 바디에서 매번 새로 정의되는 일반 함수라,
// Wrapper가 재렌더링될 때마다(=Home이 어떤 이유로든 재렌더링될 때마다)
// CompareScreen에 매번 "새 함수 레퍼런스"가 onStatusUpdate로 전달된다.
function Wrapper({ renderTick, before }: { renderTick: number; before: Received }) {
  function onStatusUpdate(status: PerformanceStatus) {
    void status;
  }
  void renderTick;
  return (
    <CompareScreen
      code="ABC123"
      previousStatus={before}
      previousSamples={[]}
      onStatusUpdate={onStatusUpdate}
      onBackToAnalysis={() => {}}
    />
  );
}

describe("CompareScreen 폴링 재현 — onStatusUpdate 레퍼런스 불안정 문제", () => {
  it("부모가 계속 재렌더링돼도(page.tsx와 동일하게 onStatusUpdate가 매번 새로 생성됨) 새 측정값이 전혀 오지 않으면 결국 stalled 상태가 돼야 한다", async () => {
    const before = baseReceived({ measuredAt: "T0" });
    // 항상 같은 measuredAt만 반환 — 절대 "새 측정값"이 아니다.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ value: JSON.stringify(before) }),
      })
    );

    act(() => {
      root.render(<Wrapper renderTick={0} before={before} />);
    });

    // Home이 CompareScreen과 무관한 이유로 3초마다 재렌더링되는 상황을
    // 흉내낸다(예: 다른 화면의 stray 콜백, 혹은 그냥 부모의 다른 상태
    // 변화) — 총 60초 동안 20번. MAX_ATTEMPTS(15) * POLL_INTERVAL_MS(2000)
    // = 30초면 원래 stalled에 도달해야 하므로, 60초는 충분히 넉넉한
        // 여유 시간이다.
    for (let i = 1; i <= 20; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      act(() => {
        root.render(<Wrapper renderTick={i} before={before} />);
      });
    }

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(container.textContent).toContain("아직 새로운 측정값이 도착하지 않았습니다");
  }, 20000);

  it("새 measuredAt을 찾은 즉시 확정하지 않고, 서로 다른 새 sample 3개를 모은 뒤 ready로 전환하며 After 그래프에 실제 line이 그려진다", async () => {
    const before = baseReceived({ measuredAt: "T0", cpuPercent: 9.9 });
    // T0(중복) → T1 → T2 → T3(마지막) 순서로 서로 다른 새 measuredAt 3개.
    const afterValues = [
      baseReceived({ measuredAt: "T1", cpuPercent: 9.0 }),
      baseReceived({ measuredAt: "T2", cpuPercent: 8.2 }),
      baseReceived({ measuredAt: "T3", cpuPercent: 7.5 }),
    ];
    const calls: PerformanceStatus[] = [];

    let tickCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        tickCount += 1;
        // tick 1~2: 아직 예전 값(T0). tick 3부터 새 값이 하나씩 도착.
        const value = tickCount <= 2 ? before : (afterValues[Math.min(tickCount - 3, afterValues.length - 1)]);
        return { ok: true, json: async () => ({ value: JSON.stringify(value) }) };
      })
    );

    function LiveWrapper({ renderTick, before: b }: { renderTick: number; before: Received }) {
      function onStatusUpdate(status: PerformanceStatus) {
        calls.push(status);
      }
      void renderTick;
      return (
        <CompareScreen
          code="ABC123"
          previousStatus={b}
          previousSamples={[]}
          onStatusUpdate={onStatusUpdate}
          onBackToAnalysis={() => {}}
        />
      );
    }

    act(() => {
      root.render(<LiveWrapper renderTick={0} before={before} />);
    });

    for (let i = 1; i <= 8; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      act(() => {
        root.render(<LiveWrapper renderTick={i} before={before} />);
      });
    }

    expect(container.textContent).toContain("가장 큰 변화");
    // 3개의 서로 다른 새 measuredAt을 실제로 모을 때까지 확정을 미뤘어야
    // 하므로, After 그래프에는 usage-graph-line(선)이 있어야 한다 —
    // usage-graph-point(단일 점)만 있다면 여전히 1개짜리로 확정한 것.
    expect(container.innerHTML).toContain("usage-graph-line");
    // 대표값은 "수집이 완료된 시점의 마지막 실제 측정값"(T3)이어야 한다.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ status: "received", measuredAt: "T3" });
    expect(container.textContent).toContain("7.5%");
  }, 20000);

  it("새 measuredAt이 딱 1개만 도착하고 그 뒤로 더 바뀌지 않아도(sample 3개를 못 채워도) 무한 대기하지 않고 그 1개로 확정한다", async () => {
    const before = baseReceived({ measuredAt: "T0", cpuPercent: 9.9 });
    const onlyNewValue = baseReceived({ measuredAt: "T1", cpuPercent: 7.5 });

    let tickCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        tickCount += 1;
        const value = tickCount <= 2 ? before : onlyNewValue; // T1에서 영원히 멈춤
        return { ok: true, json: async () => ({ value: JSON.stringify(value) }) };
      })
    );

    function StableWrapper() {
      return (
        <CompareScreen
          code="ABC123"
          previousStatus={before}
          previousSamples={[]}
          onStatusUpdate={() => {}}
          onBackToAnalysis={() => {}}
        />
      );
    }

    act(() => {
      root.render(<StableWrapper />);
    });

    // 30초 넘게 지나도(enrichment 상한 포함) 결국 ready로 확정돼야 한다 —
    // sample 3개를 못 채운다고 무한정 기다리면 안 된다.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40000);
    });

    expect(container.textContent).toContain("가장 큰 변화");
    expect(container.innerHTML).toContain("usage-graph-point");
  }, 20000);
});
