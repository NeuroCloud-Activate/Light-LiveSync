import { encrypt } from "npm:octagonal-wheels@0.1.45/encryption/encryption";

type CouchDbSecurityNamesAndRoles = {
  names?: string[];
  roles?: string[];
};

type CouchDbDatabaseSecurity = {
  admins?: CouchDbSecurityNamesAndRoles;
  members?: CouchDbSecurityNamesAndRoles;
  [key: string]: unknown;
};

const CONFIG_URI_BASE = "obsidian://setuplivesync?settings=";
const DOCID_SYNC_PARAMETERS = "_local/obsidian_livesync_sync_parameters";

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function normaliseCouchDbUri(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const parsed = new URL(withScheme);
  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/+$/, "");
}

function normaliseDatabaseName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_$()+/-]/g, "_");
}

function joinUrl(base: string, path = ""): string {
  if (!path) {
    return base.replace(/\/+$/, "");
  }
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function basicAuth(username: string, password: string): string {
  return btoa(`${username}:${password}`);
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

function randomBase64(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function requestJson<T>(
  url: string,
  username: string,
  password: string,
  options: RequestInit = {}
): Promise<{ status: number; value: T | undefined; text: string }> {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Basic ${basicAuth(username, password)}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });
  const text = await response.text();
  const value = text ? JSON.parse(text) as T : undefined;
  return { status: response.status, value, text };
}

async function ensureDatabase(baseUri: string, database: string, username: string, password: string): Promise<string> {
  const databaseUrl = joinUrl(baseUri, encodeURIComponent(database));
  const info = await requestJson<unknown>(databaseUrl, username, password);
  if (info.status >= 200 && info.status < 300) {
    return "found";
  }
  if (info.status !== 404) {
    throw new Error(`Could not read database ${database}. HTTP ${info.status}. ${info.text}`);
  }

  const created = await requestJson<unknown>(databaseUrl, username, password, { method: "PUT" });
  if (created.status === 201 || created.status === 202) {
    return "created";
  }
  if (created.status === 412) {
    return "found";
  }
  throw new Error(`Could not create database ${database}. HTTP ${created.status}. ${created.text}`);
}

async function secureDatabase(baseUri: string, database: string, username: string, password: string): Promise<string> {
  const securityUrl = joinUrl(joinUrl(baseUri, encodeURIComponent(database)), "_security");
  const current = await requestJson<CouchDbDatabaseSecurity>(securityUrl, username, password);
  if (current.status !== 200) {
    return `security unchanged; could not read _security (HTTP ${current.status})`;
  }

  const next: CouchDbDatabaseSecurity = {
    ...current.value,
    admins: addUniqueName(current.value?.admins, username),
    members: addUniqueName(current.value?.members, username)
  };
  const saved = await requestJson<unknown>(securityUrl, username, password, {
    method: "PUT",
    body: JSON.stringify(next)
  });
  if (saved.status >= 200 && saved.status < 300) {
    return "database access restricted to this CouchDB user";
  }
  return `security unchanged; could not write _security (HTTP ${saved.status})`;
}

async function ensureSyncParameters(baseUri: string, database: string, username: string, password: string): Promise<string> {
  const docPath = DOCID_SYNC_PARAMETERS.split("/").map(encodeURIComponent).join("/");
  const docUrl = joinUrl(joinUrl(baseUri, encodeURIComponent(database)), docPath);
  const existing = await requestJson<unknown>(docUrl, username, password);
  if (existing.status >= 200 && existing.status < 300) {
    return "sync parameters ready";
  }
  if (existing.status !== 404) {
    throw new Error(`Could not read sync parameters. HTTP ${existing.status}. ${existing.text}`);
  }

  const created = await requestJson<unknown>(docUrl, username, password, {
    method: "PUT",
    body: JSON.stringify({
      _id: DOCID_SYNC_PARAMETERS,
      type: "sync-parameters",
      protocolVersion: 2,
      pbkdf2salt: randomBase64(32)
    })
  });
  if (created.status >= 200 && created.status < 300) {
    return "sync parameters created";
  }
  if (created.status === 409) {
    return "sync parameters ready";
  }
  throw new Error(`Could not create sync parameters. HTTP ${created.status}. ${created.text}`);
}

async function main(): Promise<void> {
  const hostname = normaliseCouchDbUri(requiredEnv("hostname"));
  const database = normaliseDatabaseName(requiredEnv("database"));
  const username = requiredEnv("username");
  const password = requiredEnv("password");
  const passphrase = requiredEnv("passphrase");
  const uriPassphrase = Deno.env.get("uri_passphrase")?.trim() || passphrase;

  const databaseStatus = await ensureDatabase(hostname, database, username, password);
  const securityStatus = await secureDatabase(hostname, database, username, password);
  const syncParameterStatus = await ensureSyncParameters(hostname, database, username, password);
  const conf = {
    couchDB_URI: hostname,
    couchDB_USER: username,
    couchDB_PASSWORD: password,
    couchDB_DBNAME: database,
    syncOnStart: true,
    periodicReplication: true,
    syncOnSave: true,
    encrypt: true,
    passphrase,
    usePathObfuscation: true,
    useHistory: true,
    disableRequestURI: true,
    concurrencyOfReadChunksOnline: 8,
    periodicReplicationInterval: 300,
    syncMinimumInterval: 30000,
    settingVersion: 10
  };
  const encryptedConf = encodeURIComponent(await encrypt(JSON.stringify(conf), uriPassphrase, false));

  console.log(`CouchDB database ${databaseStatus}.`);
  console.log(securityStatus);
  console.log(syncParameterStatus);
  console.log("");
  console.log("Setup URI passphrase:");
  console.log(uriPassphrase);
  console.log("");
  console.log("Setup URI:");
  console.log(`${CONFIG_URI_BASE}${encryptedConf}`);
}

await main();
