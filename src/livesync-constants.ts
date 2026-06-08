export const DOCID_SYNC_PARAMETERS = "_local/obsidian_livesync_sync_parameters";
export const MILESTONE_DOCID = "_local/obsydian_livesync_milestone";

export const ENTRY_TYPES = {
  NOTE_LEGACY: "notes",
  NOTE_BINARY: "newnote",
  NOTE_PLAIN: "plain",
  CHUNK: "leaf",
  CHUNK_PACK: "chunkpack",
  VERSION_INFO: "versioninfo",
  SYNC_INFO: "syncinfo",
  SYNC_PARAMETERS: "sync-parameters",
  MILESTONE_INFO: "milestoneinfo"
} as const;

export type LiveSyncEntryType = (typeof ENTRY_TYPES)[keyof typeof ENTRY_TYPES] | (string & {});

export type LiveSyncEntryBase = {
  _id: string;
  _rev?: string;
  _deleted?: boolean;
  type?: LiveSyncEntryType;
};

export type LiveSyncFileDocument = LiveSyncEntryBase & {
  type: typeof ENTRY_TYPES.NOTE_LEGACY | typeof ENTRY_TYPES.NOTE_BINARY | typeof ENTRY_TYPES.NOTE_PLAIN;
  path: string;
  children?: string[];
  data?: string | string[];
  mtime: number;
  ctime: number;
  size: number;
  deleted?: boolean;
  eden?: Record<string, unknown>;
  e_?: boolean;
};

export type LiveSyncChunkDocument = LiveSyncEntryBase & {
  type: typeof ENTRY_TYPES.CHUNK | typeof ENTRY_TYPES.CHUNK_PACK;
  data: string;
  e_?: boolean;
};

export type LiveSyncDocument = {
  _id: string;
  _rev?: string;
  _deleted?: boolean;
  type?: LiveSyncEntryType;
  path?: string;
  children?: string[];
  data?: string | string[];
  mtime?: number;
  ctime?: number;
  size?: number;
  deleted?: boolean;
  eden?: Record<string, unknown>;
  e_?: boolean;
  pbkdf2salt?: string;
  llsVersion?: boolean;
  versionFor?: string;
  versionCreatedAt?: number;
  versionHash?: string;
  versionSnapshot?: LiveSyncDocument;
};

export function isLiveSyncFileDocument(doc: LiveSyncDocument | undefined): doc is LiveSyncFileDocument {
  return (
    !!doc &&
    (doc.type === ENTRY_TYPES.NOTE_BINARY || doc.type === ENTRY_TYPES.NOTE_PLAIN || doc.type === ENTRY_TYPES.NOTE_LEGACY) &&
    typeof doc.path === "string"
  );
}

export function isLiveSyncChunkDocument(doc: LiveSyncDocument | undefined): doc is LiveSyncChunkDocument {
  return (
    !!doc &&
    (doc.type === ENTRY_TYPES.CHUNK || doc.type === ENTRY_TYPES.CHUNK_PACK) &&
    typeof doc.data === "string"
  );
}

export function isLiveSyncSystemDocument(doc: LiveSyncDocument | undefined, id = doc?._id ?? ""): boolean {
  if (!doc) {
    return id.startsWith("_design/") || id.startsWith("_local/");
  }
  return (
    id.startsWith("_design/") ||
    id.startsWith("_local/") ||
    doc.type === ENTRY_TYPES.VERSION_INFO ||
    doc.type === ENTRY_TYPES.SYNC_INFO ||
    doc.type === ENTRY_TYPES.SYNC_PARAMETERS ||
    doc.type === ENTRY_TYPES.MILESTONE_INFO
  );
}
