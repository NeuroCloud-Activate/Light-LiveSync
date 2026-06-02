import type { SyncOutcome, SyncReason } from "./sync-engine";

export type SchedulerEngine = {
  sync(reason: SyncReason): Promise<SyncOutcome>;
};

export type SchedulerHost = {
  getMinimumIntervalMs(): number;
  getFailureCooldownMs?(): number;
  log(message: string): void;
  setStatus(message: string): void;
  onSyncStart?(reason: SyncReason, startedAt: number): void;
  onSyncFinish?(details: {
    reason: SyncReason;
    startedAt: number;
    finishedAt: number;
    result?: SyncOutcome;
    errorMessage?: string;
  }): void;
};

export class SyncScheduler {
  private readonly engine: SchedulerEngine;
  private readonly host: SchedulerHost;
  private running = false;
  private queuedReason: SyncReason | undefined;
  private scheduledTimer: number | undefined;
  private lastStartedAt = 0;
  private nextAutomaticRunAfter = 0;

  constructor(engine: SchedulerEngine, host: SchedulerHost) {
    this.engine = engine;
    this.host = host;
  }

  request(reason: SyncReason, immediate = false): void {
    this.queuedReason = reason;
    if (this.running) {
      this.host.setStatus(`Queued sync: ${reason}`);
      return;
    }

    if (this.scheduledTimer !== undefined) {
      return;
    }

    const delay = immediate ? 0 : this.delayUntilNextAllowedRun(reason);
    this.scheduledTimer = window.setTimeout(() => {
      this.scheduledTimer = undefined;
      void this.runQueued();
    }, delay);
    this.host.setStatus(delay > 0 ? `Sync scheduled in ${Math.ceil(delay / 1000)}s` : `Sync queued: ${reason}`);
  }

  cancel(): void {
    if (this.scheduledTimer !== undefined) {
      window.clearTimeout(this.scheduledTimer);
      this.scheduledTimer = undefined;
    }
    this.queuedReason = undefined;
  }

  private delayUntilNextAllowedRun(reason: SyncReason): number {
    const elapsed = Date.now() - this.lastStartedAt;
    const minimumDelay = Math.max(0, this.host.getMinimumIntervalMs() - elapsed);
    const cooldownDelay = reason === "manual"
      ? 0
      : Math.max(0, this.nextAutomaticRunAfter - Date.now());
    return Math.max(minimumDelay, cooldownDelay);
  }

  private recordFailureCooldown(): void {
    const cooldown = Math.max(0, this.host.getFailureCooldownMs?.() ?? 0);
    if (cooldown > 0) {
      this.nextAutomaticRunAfter = Math.max(this.nextAutomaticRunAfter, Date.now() + cooldown);
    }
  }

  private async runQueued(): Promise<void> {
    if (this.running) {
      return;
    }

    while (this.queuedReason) {
      const reason = this.queuedReason;
      this.queuedReason = undefined;
      this.running = true;
      this.lastStartedAt = Date.now();
      const startedAt = this.lastStartedAt;
      this.host.onSyncStart?.(reason, startedAt);
      this.host.setStatus(`Syncing: ${reason}`);

      try {
        const result = await this.engine.sync(reason);
        this.host.setStatus(result.message);
        if (!result.ok) {
          this.host.log(result.message);
          this.recordFailureCooldown();
        } else if (result.continueSync) {
          this.host.log("More sync work is still queued, so Light-LiveSync will continue with another sync pass automatically.");
          this.queuedReason = reason;
        }
        this.host.onSyncFinish?.({ reason, startedAt, finishedAt: Date.now(), result });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.host.log(`Sync failed: ${message}`);
        this.host.setStatus(`Sync failed: ${message}`);
        this.recordFailureCooldown();
        this.host.onSyncFinish?.({ reason, startedAt, finishedAt: Date.now(), errorMessage: message });
      } finally {
        this.running = false;
      }

      if (this.queuedReason) {
        const delay = this.delayUntilNextAllowedRun(this.queuedReason);
        if (delay > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, delay));
        }
      }
    }
  }
}
