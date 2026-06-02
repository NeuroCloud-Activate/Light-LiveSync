export type StatusTimerHandle = unknown;

export type CalmStatusPresenterHost<TimerHandle = StatusTimerHandle> = {
  now(): number;
  setText(message: string): void;
  setTimer(callback: () => void, delayMs: number): TimerHandle;
  clearTimer(timer: TimerHandle): void;
};

export class CalmStatusPresenter<TimerHandle = StatusTimerHandle> {
  private readonly minimumVisibleMs: number;
  private readonly host: CalmStatusPresenterHost<TimerHandle>;
  private visibleUntil = 0;
  private queuedMessage = "";
  private timer?: TimerHandle;

  constructor(
    host: CalmStatusPresenterHost<TimerHandle>,
    options: { minimumVisibleMs?: number } = {}
  ) {
    this.host = host;
    this.minimumVisibleMs = options.minimumVisibleMs ?? 1000;
  }

  set(message: string): void {
    const now = this.host.now();
    if (now >= this.visibleUntil) {
      this.clearQueuedTimer();
      this.apply(message);
      return;
    }

    this.queuedMessage = message;
    if (!this.timer) {
      this.timer = this.host.setTimer(() => this.flushQueued(), this.visibleUntil - now);
    }
  }

  cancel(): void {
    this.clearQueuedTimer();
    this.queuedMessage = "";
  }

  private flushQueued(): void {
    this.timer = undefined;
    const message = this.queuedMessage;
    this.queuedMessage = "";
    if (message) {
      this.apply(message);
    }
  }

  private apply(message: string): void {
    this.host.setText(message);
    this.visibleUntil = this.host.now() + this.minimumVisibleMs;
  }

  private clearQueuedTimer(): void {
    if (this.timer) {
      this.host.clearTimer(this.timer);
      this.timer = undefined;
    }
  }
}
