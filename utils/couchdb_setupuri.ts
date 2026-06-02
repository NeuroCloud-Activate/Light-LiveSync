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

type Credentials = {
  username: string;
  password: string;
};

type CouchDbUserDocument = {
  _id?: string;
  _rev?: string;
  name?: string;
  type?: "user";
  roles?: string[];
};

const CONFIG_URI_BASE = "obsidian://setuplivesync?settings=";
const DOCID_SYNC_PARAMETERS = "_local/obsidian_livesync_sync_parameters";
const PLACEHOLDER_PREFIX = "PASTE_";

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value || value.startsWith(PLACEHOLDER_PREFIX)) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function optionalEnv(...names: string[]): string {
  for (const name of names) {
    const value = Deno.env.get(name)?.trim();
    if (value && !value.startsWith(PLACEHOLDER_PREFIX)) {
      return value;
    }
  }
  return "";
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
  credentials: Credentials,
  options: RequestInit = {}
): Promise<{ status: number; value: T | undefined; text: string }> {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Basic ${basicAuth(credentials.username, credentials.password)}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });
  const text = await response.text();
  let value: T | undefined;
  try {
    value = text ? JSON.parse(text) as T : undefined;
  } catch {
    value = undefined;
  }
  return { status: response.status, value, text };
}

function explainAuthError(scope: string): string {
  return [
    `${scope} returned HTTP 401.`,
    "CouchDB rejected the supplied credentials.",
    "If you are creating a new sync user or database, set admin_username and admin_password to an existing CouchDB admin.",
    "The username/password fields are the sync account that will be placed into the setup URI."
  ].join(" ");
}

async function ensureUser(baseUri: string, sync: Credentials, admin: Credentials | undefined): Promise<string> {
  if (!admin) {
    return "sync user unchanged; no admin credentials supplied";
  }
  if (admin.username === sync.username && admin.password === sync.password) {
    return "sync user is the supplied admin account";
  }

  const userId = `org.couchdb.user:${sync.username}`;
  const userUrl = joinUrl(joinUrl(baseUri, "_users"), encodeURIComponent(userId));
  const existing = await requestJson<CouchDbUserDocument>(userUrl, admin);
  if (existing.status !== 200 && existing.status !== 404) {
    if (existing.status === 401) {
      throw new Error(explainAuthError("CouchDB admin user setup"));
    }
    throw new Error(`Could not read CouchDB user ${sync.username}. HTTP ${existing.status}. ${existing.text}`);
  }

  const userDocument: CouchDbUserDocument & { password: string } = {
    ...(existing.status === 200 ? existing.value : {}),
    _id: userId,
    ...(existing.value?._rev ? { _rev: existing.value._rev } : {}),
    name: sync.username,
    type: "user",
    roles: existing.value?.roles ?? [],
    password: sync.password
  };
  const saved = await requestJson<unknown>(userUrl, admin, {
    method: "PUT",
    body: JSON.stringify(userDocument)
  });
  if (saved.status >= 200 && saved.status < 300) {
    return existing.status === 200 ? "sync user updated" : "sync user created";
  }
  throw new Error(`Could not save CouchDB user ${sync.username}. HTTP ${saved.status}. ${saved.text}`);
}

async function ensureDatabase(baseUri: string, database: string, credentials: Credentials): Promise<string> {
  const databaseUrl = joinUrl(baseUri, encodeURIComponent(database));
  const info = await requestJson<unknown>(databaseUrl, credentials);
  if (info.status >= 200 && info.status < 300) {
    return "found";
  }
  if (info.status === 401) {
    throw new Error(explainAuthError(`Could not read database ${database}`));
  }
  if (info.status !== 404) {
    throw new Error(`Could not read database ${database}. HTTP ${info.status}. ${info.text}`);
  }

  const created = await requestJson<unknown>(databaseUrl, credentials, { method: "PUT" });
  if (created.status === 201 || created.status === 202) {
    return "created";
  }
  if (created.status === 412) {
    return "found";
  }
  throw new Error(`Could not create database ${database}. HTTP ${created.status}. ${created.text}`);
}

async function secureDatabase(baseUri: string, database: string, syncUsername: string, credentials: Credentials): Promise<string> {
  const securityUrl = joinUrl(joinUrl(baseUri, encodeURIComponent(database)), "_security");
  const current = await requestJson<CouchDbDatabaseSecurity>(securityUrl, credentials);
  if (current.status !== 200) {
    if (current.status === 401) {
      throw new Error(explainAuthError("CouchDB database security"));
    }
    return `security unchanged; could not read _security (HTTP ${current.status})`;
  }

  const next: CouchDbDatabaseSecurity = {
    ...current.value,
    members: addUniqueName(current.value?.members, syncUsername)
  };
  const saved = await requestJson<unknown>(securityUrl, credentials, {
    method: "PUT",
    body: JSON.stringify(next)
  });
  if (saved.status >= 200 && saved.status < 300) {
    return "database access restricted to this CouchDB user";
  }
  return `security unchanged; could not write _security (HTTP ${saved.status})`;
}

async function ensureSyncParameters(baseUri: string, database: string, credentials: Credentials): Promise<string> {
  const docPath = DOCID_SYNC_PARAMETERS.split("/").map(encodeURIComponent).join("/");
  const docUrl = joinUrl(joinUrl(baseUri, encodeURIComponent(database)), docPath);
  const existing = await requestJson<unknown>(docUrl, credentials);
  if (existing.status >= 200 && existing.status < 300) {
    return "sync parameters ready";
  }
  if (existing.status === 401) {
    throw new Error(explainAuthError("CouchDB sync parameters"));
  }
  if (existing.status !== 404) {
    throw new Error(`Could not read sync parameters. HTTP ${existing.status}. ${existing.text}`);
  }

  const created = await requestJson<unknown>(docUrl, credentials, {
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

async function verifySyncUser(baseUri: string, database: string, sync: Credentials): Promise<string> {
  const databaseUrl = joinUrl(baseUri, encodeURIComponent(database));
  const info = await requestJson<unknown>(databaseUrl, sync);
  if (info.status >= 200 && info.status < 300) {
    return "sync user verified";
  }
  if (info.status === 401) {
    throw new Error("The sync user was created or selected, but CouchDB still rejected it with HTTP 401. Check the sync username/password and rerun the helper with CouchDB admin credentials if this is a new user.");
  }
  throw new Error(`The sync user could not read database ${database}. HTTP ${info.status}. ${info.text}`);
}

async function main(): Promise<void> {
  const hostname = normaliseCouchDbUri(requiredEnv("hostname"));
  const database = normaliseDatabaseName(requiredEnv("database"));
  const username = requiredEnv("username");
  const password = requiredEnv("password");
  const passphrase = requiredEnv("passphrase");
  const uriPassphrase = Deno.env.get("uri_passphrase")?.trim() || passphrase;
  const adminUsername = optionalEnv("admin_username", "COUCHDB_ADMIN_USER", "COUCHDB_USER");
  const adminPassword = optionalEnv("admin_password", "COUCHDB_ADMIN_PASSWORD", "COUCHDB_PASSWORD");
  if ((adminUsername && !adminPassword) || (!adminUsername && adminPassword)) {
    throw new Error("admin_username and admin_password must be supplied together.");
  }
  const syncCredentials = { username, password };
  const setupCredentials = adminUsername && adminPassword
    ? { username: adminUsername, password: adminPassword }
    : syncCredentials;
  const adminCredentials = adminUsername && adminPassword ? setupCredentials : undefined;

  const userStatus = await ensureUser(hostname, syncCredentials, adminCredentials);
  const databaseStatus = await ensureDatabase(hostname, database, setupCredentials);
  const securityStatus = await secureDatabase(hostname, database, username, setupCredentials);
  const syncParameterStatus = await ensureSyncParameters(hostname, database, setupCredentials);
  const syncUserStatus = await verifySyncUser(hostname, database, syncCredentials);
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

  console.log(userStatus);
  console.log(`CouchDB database ${databaseStatus}.`);
  console.log(securityStatus);
  console.log(syncParameterStatus);
  console.log(syncUserStatus);
  console.log("");
  console.log("Setup URI passphrase:");
  console.log(uriPassphrase);
  console.log("");
  console.log("Setup URI:");
  console.log(`${CONFIG_URI_BASE}${encryptedConf}`);
}

await main();
