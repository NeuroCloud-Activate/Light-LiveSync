import { buildLiveSyncPushBundle, type LiveSyncBuildOptions, type LiveSyncPushBundle, type LocalFileSnapshot } from "./livesync-document-builder";

type WorkerClientOptions = {
  enabled(): boolean;
  scriptUrl(): string | undefined;
  scriptSource?(): Promise<string | undefined>;
  yieldToUi?(): Promise<void>;
  log(message: string): void;
};

type PendingWorkerRequest = {
  resolve(result: LiveSyncPushBundle): void;
  reject(error: Error): void;
};

type WorkerResponse = {
  id: number;
  ok: boolean;
  result?: LiveSyncPushBundle;
  error?: string;
};

export class OptionalSyncWorkerClient {
  private worker?: Worker;
  private workerObjectUrl?: string;
  private disabled = false;
  private fallbackLogged = false;
  private nextRequestId = 1;
  private pending = new Map<number, PendingWorkerRequest>();
  private readonly options: WorkerClientOptions;

  constructor(options: WorkerClientOptions) {
    this.options = options;
  }

  async buildPushBundle(snapshot: LocalFileSnapshot, options: LiveSyncBuildOptions): Promise<LiveSyncPushBundle> {
    if (!this.options.enabled() || this.disabled) {
      await this.options.yieldToUi?.();
      return buildLiveSyncPushBundle(snapshot, options, { yieldToUi: this.options.yieldToUi });
    }

    try {
      return await this.buildPushBundleInWorker(snapshot, options);
    } catch (error) {
      this.disabled = true;
      if (!this.fallbackLogged) {
        this.fallbackLogged = true;
        this.options.log(`Background worker failed; using the cooperative main-thread push builder for this session. ${friendlyWorkerError(error)}`);
        console.warn("[Light-LiveSync] Background worker unavailable; using main-thread push builder.", error);
      }
      await this.options.yieldToUi?.();
      return buildLiveSyncPushBundle(snapshot, options, { yieldToUi: this.options.yieldToUi });
    }
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = undefined;
    this.revokeWorkerObjectUrl();
    for (const request of this.pending.values()) {
      request.reject(new Error("Background worker disposed."));
    }
    this.pending.clear();
  }

  private async buildPushBundleInWorker(snapshot: LocalFileSnapshot, options: LiveSyncBuildOptions): Promise<LiveSyncPushBundle> {
    const worker = await this.requireWorker();
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage(
        {
          id,
          type: "build-push-bundle",
          snapshot,
          options
        },
        snapshot.content instanceof ArrayBuffer ? [snapshot.content] : []
      );
    });
  }

  private async requireWorker(): Promise<Worker> {
    if (this.worker) {
      return this.worker;
    }

    const scriptUrl = await this.workerScriptUrl();
    if (!scriptUrl) {
      throw new Error("No worker script URL is available.");
    }

    const worker = new Worker(scriptUrl);
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.handleMessage(event.data);
    worker.onerror = (event) => this.handleWorkerError(event.message || "Worker error.");
    this.worker = worker;
    return worker;
  }

  private async workerScriptUrl(): Promise<string | undefined> {
    const source = await this.options.scriptSource?.();
    if (source && typeof Blob !== "undefined" && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
      this.revokeWorkerObjectUrl();
      this.workerObjectUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
      return this.workerObjectUrl;
    }
    return this.options.scriptUrl();
  }

  private handleMessage(response: WorkerResponse): void {
    const request = this.pending.get(response.id);
    if (!request) {
      return;
    }
    this.pending.delete(response.id);
    if (response.ok && response.result) {
      request.resolve(response.result);
    } else {
      request.reject(new Error(response.error || "Worker request failed."));
    }
  }

  private handleWorkerError(message: string): void {
    this.disabled = true;
    this.options.log(`Background worker failed: ${message}`);
    for (const request of this.pending.values()) {
      request.reject(new Error(message));
    }
    this.pending.clear();
    this.worker?.terminate();
    this.worker = undefined;
    this.revokeWorkerObjectUrl();
  }

  private revokeWorkerObjectUrl(): void {
    if (this.workerObjectUrl && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(this.workerObjectUrl);
    }
    this.workerObjectUrl = undefined;
  }
}

function friendlyWorkerError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/cannot be accessed from origin/i.test(message)) {
    return "Reason: Obsidian blocked the worker script URL.";
  }
  if (/No worker script URL/i.test(message)) {
    return "Reason: no worker script URL was available.";
  }
  if (/worker/i.test(message)) {
    return `Reason: ${message.slice(0, 180)}`;
  }
  return "Open the developer console for the full worker error.";
}
