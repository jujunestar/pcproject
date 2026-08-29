// PollingController는 DOM/브라우저 API에 의존하지 않는 순수 상태 머신이라,
// jsdom이나 새 테스트 라이브러리 없이 vitest 내장 fake timer만으로 검증할 수
// 있다. "AnalysisScreen mount 후 폴링 시작"은 controller.start() 호출로,
// "unmount 후 폴링 중지"는 controller.stop() 호출로, "hidden/visible"은
// controller.setVisible(false/true) 호출로 각각 대응한다 — 실제 React
// useEffect/document.visibilitychange 배선 자체는 이 프로젝트에 DOM 렌더
// 테스트 인프라가 없어 production 수동 확인으로 검증한다(docs/slices/
// real-time-performance-graph.md 테스트 계획 참고).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PollingController } from "./polling-controller";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PollingController", () => {
  it("start() 이후 2000ms마다 onTick이 호출된다 (mount 후 폴링 시작에 대응)", () => {
    const onTick = vi.fn();
    const controller = new PollingController({ intervalMs: 2000, onTick });

    controller.start();
    expect(onTick).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);
    expect(onTick).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2000);
    expect(onTick).toHaveBeenCalledTimes(2);
  });

  it("stop() 이후에는 더 이상 onTick이 호출되지 않는다 (unmount 후 폴링 중지에 대응)", () => {
    const onTick = vi.fn();
    const controller = new PollingController({ intervalMs: 2000, onTick });

    controller.start();
    controller.stop();
    vi.advanceTimersByTime(10000);

    expect(onTick).not.toHaveBeenCalled();
  });

  it("start()를 여러 번 호출해도 중복 interval이 생기지 않는다", () => {
    const onTick = vi.fn();
    const controller = new PollingController({ intervalMs: 2000, onTick });

    controller.start();
    controller.start();
    controller.start();
    vi.advanceTimersByTime(2000);

    expect(onTick).toHaveBeenCalledTimes(1);
  });

  it("setVisible(false)면 폴링이 멈춘다 (탭 hidden에 대응)", () => {
    const onTick = vi.fn();
    const controller = new PollingController({ intervalMs: 2000, onTick });

    controller.start();
    controller.setVisible(false);
    vi.advanceTimersByTime(10000);

    expect(onTick).not.toHaveBeenCalled();
  });

  it("setVisible(true)로 복귀하면 즉시 1회 호출된 뒤 다시 폴링이 재개된다 (탭 visible 복귀에 대응)", () => {
    const onTick = vi.fn();
    const controller = new PollingController({ intervalMs: 2000, onTick });

    controller.start();
    controller.setVisible(false);
    controller.setVisible(true);

    expect(onTick).toHaveBeenCalledTimes(1); // 즉시 1회

    vi.advanceTimersByTime(2000);
    expect(onTick).toHaveBeenCalledTimes(2); // 재개된 폴링
  });

  it("이미 visible인 상태에서 setVisible(true)를 불러도 즉시 tick이 중복 발생하지 않는다", () => {
    const onTick = vi.fn();
    const controller = new PollingController({ intervalMs: 2000, onTick });

    controller.start();
    controller.setVisible(true);
    controller.setVisible(true);

    expect(onTick).not.toHaveBeenCalled();
  });

  it("hidden 상태로 mount되면(start 시점에 이미 비visible) 폴링을 시작하지 않는다", () => {
    const onTick = vi.fn();
    const controller = new PollingController({ intervalMs: 2000, onTick });

    controller.setVisible(false);
    controller.start();
    vi.advanceTimersByTime(10000);

    expect(onTick).not.toHaveBeenCalled();
    expect(controller.isRunning()).toBe(false);
  });
});
