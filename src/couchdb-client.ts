import { requestUrl, type RequestUrlParam } from "obsidian";
import { DOCID_SYNC_PARAMETERS, ENTRY_TYPES, MILESTONE_DOCID, type LiveSyncDocument } from "./livesync-constants";
import type { CouchDbSettings } from "./settings";

export type CouchDbInfo = {
  db_name: string;
  doc_count: number;
  update_seq: string | number;
  sizes?: Record<string, number>;
};

export type CouchDbServerInfo = {
  couchdb?: string;
  version?: string;
  vendor?: unknown;
};

export type CouchDbChange = {
  id: string;
  seq: string | number;
  deleted?: boolean;
  doc?: LiveSyncDocument;
};

export type RemoteInspection = {
  serverVersion: string;
  databaseName: string;
  documentCount: number;
  updateSequence: string;
  syncParametersPresent: boolean;
  syncParameterSalt: string;
  milestonePresent: boolean;
  sample: {
    total: number;
    notes: number;
    chunks: number;
    system: number;
    deleted: number;
    unknown: number;
  };
};

export type PullRemoteChangesResult = {
  changes: CouchDbChange[];
  lastSeq: string;
};

export type SyncParameters = {
  _id: typeof DOCID_SYNC_PARAMETERS;
  _rev?: string;
  type: typeof ENTRY_TYPES.SYNC_PARAMETERS;
  protocolVersion: 2;
  pbkdf2salt: string;
};

export type EnsureSyncParametersResult = {
  created: boolean;
  parameters: SyncParameters;
};

export type EnsureDatabaseResult = {
  created: boolean;
  info: CouchDbInfo;
};

export type CouchDbSecurityNamesAndRoles = {
  names?: string[];
  roles?: string[];
};

export type CouchDbDatabaseSecurity = {
  admins?: CouchDbSecurityNamesAndRoles;
  members?: CouchDbSecurityNamesAndRoles;
  [key: string]: unknown;
};

export type BulkDocumentResult = {
  id: string;
  ok?: boolean;
  rev?: string;
  error?: string;
  reason?: string;
};

type AllDocsRow = {
  id: string;
  key: string;
  value?: {
    rev?: string;
    deleted?: boolean;
  };
  error?: string;
};

export type PutLiveSyncBundleResult = {
  fileId: string;
  written: number;
  reused: number;
  conflicts: number;
};

type CouchDbRawResponse = {
  status: number;
  text: string;
  arrayBuffer?: ArrayBuffer;
};

export class CouchDbClientError extends Error {
  readonly status?: number;

  constructor(
    message: string,
    status?: number,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "CouchDbClientError";
    this.status = status;
  }
}

const NOTE_TYPES = new Set<string>([ENTRY_TYPES.NOTE_BINARY, ENTRY_TYPES.NOTE_PLAIN, ENTRY_TYPES.NOTE_LEGACY]);
const CHUNK_TYPES = new Set<string>([ENTRY_TYPES.CHUNK, ENTRY_TYPES.CHUNK_PACK]);
const SYSTEM_TYPES = new Set<string>([
  ENTRY_TYPES.VERSION_INFO,
  ENTRY_TYPES.SYNC_INFO,
  ENTRY_TYPES.SYNC_PARAMETERS,
  ENTRY_TYPES.MILESTONE_INFO
]);
const COUCHDB_REQUEST_TIMEOUT_MS = 20_000;

function encodeBasicAuth(username: string, password: string): string | undefined {
  if (!username && !password) {
    return undefined;
  }
  return `Basic ${btoa(`${username}:${password}`)}`;
}

function joinUrl(base: string, path = ""): string {
  if (!path) {
    return base.replace(/\/+$/, "");
  }
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function encodeDocumentId(id: string): string {
  if (id.startsWith("_local/") || id.startsWith("_design/")) {
    const [prefix, ...rest] = id.split("/");
    return `${encodeURIComponent(prefix)}/${encodeURIComponent(rest.join("/"))}`;
  }
  return encodeURIComponent(id);
}

function parseCustomHeaders(customHeaders: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const header of customHeaders.split("\n")) {
    const delimiter = header.indexOf(":");
    if (delimiter <= 0) {
      continue;
    }
    const key = header.slice(0, delimiter).trim();
    const value = header.slice(delimiter + 1).trim();
    if (key && value) {
      headers[key] = value;
    }
  }
  return headers;
}

function addUniqueName(section: CouchDbSecurityNamesAndRoles | undefined, name: string): CouchDbSecurityNamesAndRoles {
  const names = new Set(section?.names ?? []);
  names.add(name);
  return {
    ...section,
    names: [...names],
    roles: section?.roles ?? []
  };
}

function textFromResponse(response: CouchDbRawResponse): string {
  if (response.text) {
    return response.text;
  }
  if (response.arrayBuffer !== undefined) {
    return new TextDecoder().decode(response.arrayBuffer);
  }
  return "";
}

function randomBase64(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function couchDbTransportMessage(error: unknown, uri: string): string {
  const message = messageFromError(error);
  if (/ERR_ADDRESS_UNREACHABLE|ERR_CONNECTION_REFUSED|ERR_NETWORK_CHANGED|ERR_NETWORK_ACCESS_DENIED|Failed to fetch/i.test(message)) {
    return `Could not reach CouchDB at ${uri}. Check that Obsidian has local-network access, the server is reachable from this device, and firewall/VPN rules allow the connection. ${message}`;
  }
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND/i.test(message)) {
    return `Could not resolve the CouchDB host ${uri}. Check the hostname or DNS settings. ${message}`;
  }
  if (/timed out/i.test(message)) {
    return `CouchDB did not respond at ${uri} within ${Math.round(COUCHDB_REQUEST_TIMEOUT_MS / 1000)} seconds. Check Obsidian local-network access, server reachability, and firewall/VPN routing.`;
  }
  return `CouchDB request could not be sent to ${uri}. ${message}`;
}

function couchDbHttpErrorMessage(status: number, settings: CouchDbSettings): string {
  if (status === 401) {
    return [
      "CouchDB rejected the username or password with HTTP 401.",
      "Check that the CouchDB username and password are exact, including case and special characters.",
      "If the account was just created, confirm it can log in to the same CouchDB server and database.",
      `Server: ${settings.uri}`,
      `Database: ${settings.database || "not selected"}`,
      `Username: ${settings.username || "not provided"}`
    ].join(" ");
  }
  if (status === 403) {
    return [
      "CouchDB accepted the account but blocked this action with HTTP 403.",
      "Confirm the user has permission to create, read, and write the selected database.",
      `Server: ${settings.uri}`,
      `Database: ${settings.database || "not selected"}`,
      `Username: ${settings.username || "not provided"}`
    ].join(" ");
  }
  return `CouchDB request failed with HTTP ${status}.`;
}

export class CouchDbClient {
  private readonly settings: CouchDbSettings;

  constructor(settings: CouchDbSettings) {
    this.settings = settings;
  }

  async inspect(): Promise<RemoteInspection> {
    const [serverInfo, dbInfo, syncParameters, milestone, changes] = await Promise.all([
      this.getServerInfo(),
      this.getDatabaseInfo(),
      this.getOptionalDocument(DOCID_SYNC_PARAMETERS),
      this.getOptionalDocument(MILESTONE_DOCID),
      this.getRecentChanges(50)
    ]);

    const sample = this.summariseChanges(changes);
    return {
      serverVersion: serverInfo.version ?? "unknown",
      databaseName: dbInfo.db_name,
      documentCount: dbInfo.doc_count,
      updateSequence: String(dbInfo.update_seq),
      syncParametersPresent: !!syncParameters,
      syncParameterSalt: typeof syncParameters?.pbkdf2salt === "string" ? syncParameters.pbkdf2salt : "",
      milestonePresent: !!milestone,
      sample
    };
  }

  async getServerInfo(): Promise<CouchDbServerInfo> {
    return this.requestJson<CouchDbServerInfo>("", false);
  }

  async getDatabaseInfo(): Promise<CouchDbInfo> {
    return this.requestJson<CouchDbInfo>("");
  }

  async ensureDatabase(): Promise<EnsureDatabaseResult> {
    try {
      return {
        created: false,
        info: await this.getDatabaseInfo()
      };
    } catch (error) {
      if (!(error instanceof CouchDbClientError) || error.status !== 404) {
        throw error;
      }
    }

    const response = await this.requestRaw(encodeURIComponent(this.settings.database), false, "PUT");
    if (response.status === 412) {
      return {
        created: false,
        info: await this.getDatabaseInfo()
      };
    }
    if (response.status < 200 || response.status >= 300) {
      throw new CouchDbClientError(`Could not create CouchDB database. HTTP ${response.status}.`, response.status);
    }

    return {
      created: true,
      info: await this.getDatabaseInfo()
    };
  }

  async getDatabaseSecurity(): Promise<CouchDbDatabaseSecurity> {
    return this.requestJson<CouchDbDatabaseSecurity>("_security");
  }

  async secureDatabaseForCurrentUser(): Promise<CouchDbDatabaseSecurity> {
    if (!this.settings.username) {
      throw new CouchDbClientError("Could not secure CouchDB database without a username.");
    }

    const current: CouchDbDatabaseSecurity = await this.getDatabaseSecurity().catch(() => ({}));
    const next: CouchDbDatabaseSecurity = {
      ...current,
      admins: addUniqueName(current.admins, this.settings.username),
      members: addUniqueName(current.members, this.settings.username)
    };
    const response = await this.requestRaw("_security", true, "PUT", next);
    if (response.status < 200 || response.status >= 300) {
      throw new CouchDbClientError(`Could not secure CouchDB database. HTTP ${response.status}.`, response.status);
    }
    return this.getDatabaseSecurity();
  }

  async getOptionalDocument(id: string): Promise<LiveSyncDocument | undefined> {
    try {
      return await this.requestJson<LiveSyncDocument>(encodeDocumentId(id));
    } catch (error) {
      if (error instanceof CouchDbClientError && error.status === 404) {
        return undefined;
      }
      throw error;
    }
  }

  async getRecentChanges(limit: number): Promise<CouchDbChange[]> {
    const query = new URLSearchParams({
      include_docs: "true",
      limit: String(limit),
      descending: "true"
    });
    const result = await this.requestJson<{ results?: CouchDbChange[] }>(`_changes?${query.toString()}`);
    return result.results ?? [];
  }

  async getChangesSince(since: string | number, limit: number): Promise<PullRemoteChangesResult> {
    const query = new URLSearchParams({
      include_docs: "true",
      limit: String(limit),
      since: String(since || "0")
    });
    const result = await this.requestJson<{ results?: CouchDbChange[]; last_seq?: string | number }>(
      `_changes?${query.toString()}`
    );
    return {
      changes: result.results ?? [],
      lastSeq: String(result.last_seq ?? since ?? "0")
    };
  }

  async ensureSyncParameters(): Promise<EnsureSyncParametersResult> {
    const existing = await this.getOptionalDocument(DOCID_SYNC_PARAMETERS);
    if (existing) {
      return {
        created: false,
        parameters: existing as SyncParameters
      };
    }

    const parameters: SyncParameters = {
      _id: DOCID_SYNC_PARAMETERS,
      type: ENTRY_TYPES.SYNC_PARAMETERS,
      protocolVersion: 2,
      pbkdf2salt: randomBase64(32)
    };

    const response = await this.requestRaw(encodeDocumentId(DOCID_SYNC_PARAMETERS), true, "PUT", parameters);
    if (response.status === 409) {
      const raced = await this.getOptionalDocument(DOCID_SYNC_PARAMETERS);
      if (raced) {
        return {
          created: false,
          parameters: raced as SyncParameters
        };
      }
    }
    if (response.status < 200 || response.status >= 300) {
      throw new CouchDbClientError(`Could not initialise sync parameters. HTTP ${response.status}.`, response.status);
    }

    const saved = await this.getOptionalDocument(DOCID_SYNC_PARAMETERS);
    return {
      created: true,
      parameters: (saved ?? parameters) as SyncParameters
    };
  }

  async putLiveSyncBundle(fileDocument: LiveSyncDocument, chunkDocuments: LiveSyncDocument[]): Promise<PutLiveSyncBundleResult> {
    const revisions = await this.getExistingRevisions([
      fileDocument._id,
      ...chunkDocuments.map((chunk) => chunk._id)
    ]);
    const docs = chunkDocuments.filter((chunk) => !revisions.has(chunk._id));
    const reused = chunkDocuments.length - docs.length;
    const existingFileRevision = revisions.get(fileDocument._id);
    docs.push({
      ...fileDocument,
      ...(existingFileRevision ? { _rev: existingFileRevision } : {})
    });

    const writeResult = this.summariseBulkWrite(await this.bulkDocs(docs), fileDocument._id);

    return {
      fileId: fileDocument._id,
      written: writeResult.written,
      reused: reused + writeResult.reused,
      conflicts: writeResult.conflicts
    };
  }

  async deleteLiveSyncDocument(id: string): Promise<boolean> {
    const existing = await this.getOptionalDocument(id);
    if (!existing?._rev) {
      return false;
    }
    const response = await this.requestRaw(`${encodeDocumentId(id)}?rev=${encodeURIComponent(existing._rev)}`, true, "DELETE");
    if (response.status === 404) {
      return false;
    }
    if (response.status < 200 || response.status >= 300) {
      throw new CouchDbClientError(`Could not delete LiveSync document. HTTP ${response.status}.`, response.status);
    }
    return true;
  }

  private summariseChanges(changes: CouchDbChange[]): RemoteInspection["sample"] {
    const sample: RemoteInspection["sample"] = {
      total: changes.length,
      notes: 0,
      chunks: 0,
      system: 0,
      deleted: 0,
      unknown: 0
    };

    for (const change of changes) {
      sample[this.changeSampleBucket(change)]++;
    }

    return sample;
  }

  private changeSampleBucket(change: CouchDbChange): "notes" | "chunks" | "system" | "deleted" | "unknown" {
    if (change.deleted || change.doc?._deleted) {
      return "deleted";
    }
    const type = change.doc?.type ?? "";
    if (NOTE_TYPES.has(type)) {
      return "notes";
    }
    if (CHUNK_TYPES.has(type)) {
      return "chunks";
    }
    if (SYSTEM_TYPES.has(type) || change.id.startsWith("_design/")) {
      return "system";
    }
    return "unknown";
  }

  private summariseBulkWrite(results: BulkDocumentResult[], fileId: string): {
    written: number;
    reused: number;
    conflicts: number;
  } {
    let written = 0;
    let reused = 0;
    let conflicts = 0;
    for (const result of results) {
      if (result.ok) {
        written++;
      } else if (result.error === "conflict" && result.id !== fileId) {
        conflicts++;
        reused++;
      } else {
        throw new CouchDbClientError(
          `Could not write LiveSync document ${result.id}: ${result.error ?? "unknown"} ${result.reason ?? ""}`.trim()
        );
      }
    }
    return { written, reused, conflicts };
  }

  private async requestJson<T>(path: string, includeDatabase = true, method = "GET", body?: unknown): Promise<T> {
    const response = await this.requestRaw(path, includeDatabase, method, body);
    if (response.status < 200 || response.status >= 300) {
      throw new CouchDbClientError(couchDbHttpErrorMessage(response.status, this.settings), response.status);
    }

    const text = textFromResponse(response);
    return JSON.parse(text) as T;
  }

  private async getExistingRevisions(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) {
      return new Map();
    }
    const result = await this.requestJson<{ rows?: AllDocsRow[] }>("_all_docs", true, "POST", { keys: ids });
    return new Map(
      (result.rows ?? [])
        .filter((row) => !row.error && !row.value?.deleted && row.value?.rev)
        .map((row) => [row.id, row.value?.rev ?? ""])
    );
  }

  private async bulkDocs(docs: LiveSyncDocument[]): Promise<BulkDocumentResult[]> {
    if (docs.length === 0) {
      return [];
    }
    return this.requestJson<BulkDocumentResult[]>("_bulk_docs", true, "POST", { docs });
  }

  private async requestRaw(
    path: string,
    includeDatabase: boolean,
    method = "GET",
    body?: unknown
  ): Promise<CouchDbRawResponse> {
    return this.settings.useRequestApi
      ? this.requestWithObsidianApi(path, includeDatabase, method, body)
      : this.requestWithFetch(path, includeDatabase, method, body);
  }

  private async requestWithObsidianApi(
    path: string,
    includeDatabase: boolean,
    method = "GET",
    body?: unknown
  ): Promise<CouchDbRawResponse> {
    let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = globalThis.setTimeout(() => {
          reject(new Error(`CouchDB request timed out after ${COUCHDB_REQUEST_TIMEOUT_MS}ms.`));
        }, COUCHDB_REQUEST_TIMEOUT_MS);
      });
      return await Promise.race([
        requestUrl(this.buildRequest(path, includeDatabase, method, body)),
        timeoutPromise
      ]);
    } catch (error) {
      throw new CouchDbClientError(couchDbTransportMessage(error, this.settings.uri), undefined, { cause: error });
    } finally {
      if (timeout !== undefined) {
        globalThis.clearTimeout(timeout);
      }
    }
  }

  private async requestWithFetch(
    path: string,
    includeDatabase: boolean,
    method = "GET",
    body?: unknown
  ): Promise<CouchDbRawResponse> {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => {
      controller.abort(new Error(`CouchDB request timed out after ${COUCHDB_REQUEST_TIMEOUT_MS}ms.`));
    }, COUCHDB_REQUEST_TIMEOUT_MS);
    const request = this.buildRequest(path, includeDatabase, method, body);
    try {
      const response = await fetch(request.url, {
        method,
        headers: {
          ...request.headers,
          ...(request.contentType ? { "Content-Type": request.contentType } : {})
        },
        body: request.body,
        signal: controller.signal
      });
      const arrayBuffer = await response.arrayBuffer();
      return {
        status: response.status,
        text: new TextDecoder().decode(arrayBuffer),
        arrayBuffer
      };
    } catch (error) {
      throw new CouchDbClientError(couchDbTransportMessage(error, this.settings.uri), undefined, { cause: error });
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }

  private buildRequest(path: string, includeDatabase: boolean, method = "GET", body?: unknown): RequestUrlParam {
    const headers = {
      ...parseCustomHeaders(this.settings.customHeaders)
    };
    const authorization = encodeBasicAuth(this.settings.username, this.settings.password);
    if (authorization) {
      headers.Authorization = authorization;
    }

    const base = includeDatabase ? joinUrl(this.settings.uri, encodeURIComponent(this.settings.database)) : this.settings.uri;
    return {
      url: joinUrl(base, path),
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      contentType: body === undefined ? undefined : "application/json",
      throw: false
    };
  }
}
