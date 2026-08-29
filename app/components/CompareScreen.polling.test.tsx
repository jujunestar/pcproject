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

  it("부모가 계속 재렌더링돼도 새 measuredAt이 실제로 도착하면 ready로 전환되고, 그 순간의 최신 onStatusUpdate가 호출된다", async () => {
    const before = baseReceived({ measuredAt: "T0" });
    const after = baseReceived({ measuredAt: "T1", cpuPercent: 55.0 });
    const calls: PerformanceStatus[] = [];

    let tickCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        tickCount += 1;
        const value = tickCount >= 3 ? after : before;
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
          onStatusUpdate={onStatusUpdate}
          onBackToAnalysis={() => {}}
        />
      );
    }

    act(() => {
      root.render(<LiveWrapper renderTick={0} before={before} />);
    });

    // 부모가 계속 재렌더링되는 상황을 흉내내면서(레퍼런스는 매번 바뀜),
    // 3번째 tick에서 실제로 새 measuredAt이 도착하게 한다.
    for (let i = 1; i <= 4; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      act(() => {
        root.render(<LiveWrapper renderTick={i} before={before} />);
      });
    }

    expect(container.textContent).toContain("가장 큰 변화");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ status: "received", measuredAt: "T1" });
  }, 20000);
});
