import { buildLiveSyncPushBundle, type LiveSyncBuildOptions, type LocalFileSnapshot } from "./livesync-document-builder";

type WorkerRequest = {
  id: number;
  type: "build-push-bundle";
  snapshot: LocalFileSnapshot;
  options: LiveSyncBuildOptions;
};

type WorkerSuccess = {
  id: number;
  ok: true;
  result: Awaited<ReturnType<typeof buildLiveSyncPushBundle>>;
};

type WorkerFailure = {
  id: number;
  ok: false;
  error: string;
};

async function handleRequest(request: WorkerRequest): Promise<WorkerSuccess | WorkerFailure> {
  try {
    if (request.type !== "build-push-bundle") {
      throw new Error(`Unsupported worker request: ${request.type}`);
    }
    return {
      id: request.id,
      ok: true,
      result: await buildLiveSyncPushBundle(request.snapshot, request.options)
    };
  } catch (error) {
    return {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  void handleRequest(event.data).then((response) => {
    self.postMessage(response);
  });
};
