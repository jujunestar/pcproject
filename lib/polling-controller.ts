export type PollingControllerOptions = {
  intervalMs: number;
  onTick: () => void;
};

// 브라우저 탭 visibility나 React 마운트 여부를 직접 알지 못하는, DOM에
// 의존하지 않는 순수 상태 머신이다. AnalysisScreen은 mount 시 start(),
// unmount 시 stop(), document.visibilitychange 발생 시 setVisible(...)만
// 호출하는 얇은 배선 역할만 한다 — 그래야 이 클래스를 jsdom 없이도
// vitest의 fake timer만으로 테스트할 수 있다.
export class PollingController {
  private readonly intervalMs: number;
  private readonly onTick: () => void;
  private timer: ReturnType<typeof setInterval> | null = null;
  private visible = true;

  constructor(options: PollingControllerOptions) {
    this.intervalMs = options.intervalMs;
    this.onTick = options.onTick;
  }

  start(): void {
    if (this.timer !== null) return; // 중복 interval 방지
    if (!this.visible) return; // hidden 상태로 시작하면 폴링하지 않는다
    this.timer = setInterval(this.onTick, this.intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  setVisible(visible: boolean): void {
    const wasVisible = this.visible;
    this.visible = visible;

    if (visible && !wasVisible) {
      // hidden → visible: 다음 정기 tick을 기다리지 않고 즉시 1회 확인한 뒤 재개한다.
      this.onTick();
      this.start();
    } else if (!visible && wasVisible) {
      this.stop();
    }
  }
}
