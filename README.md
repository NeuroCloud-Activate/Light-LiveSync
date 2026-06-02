# Lightweight LiveSync

Lightweight LiveSync is a separate Obsidian plugin line forked from the ideas and data format of [Self-hosted LiveSync](https://github.com/vrtmrz/obsidian-livesync). It is intended to work with the same self-hosted CouchDB backend and the same existing setup URI flow, while keeping the sync path quieter, smaller, and easier to reason about.

This project is not the upstream plugin. It is a conservative fork focused on:

- CouchDB self-hosted sync compatibility.
- Existing `obsidian://setuplivesync?settings=...` setup URI intake and encrypted setup URI generation for adding devices.
- End-to-end encryption required by default.
- Low-noise background sync with 60-second edit batching by default.
- Periodic sync as a fallback for missed events or mobile background limits.
- Automatic text merges with local recovery backups.
- Minimal status UI and diagnostics that help detect slow sync runs without constant monitoring.

## Compatibility

The plugin stores vault content in the LiveSync-shaped CouchDB document model used by Self-hosted LiveSync. It supports:

- CouchDB server URL, database, username, password, and custom headers.
- Setup URI import from the upstream setup flow.
- Add-device setup URI generation from an already-initialized first device.
- Direct in-plugin CouchDB setup using the same field names as the upstream setup generator: `hostname`, `database`, `passphrase`, `username`, and `password`.
- HKDF-encrypted note content and path obfuscation by default.
- Desktop and mobile Obsidian plugin loading; the manifest is not desktop-only.

The plugin is self-contained after bundling. Obsidian desktop and mobile devices do not need separate `npm`, `pnpm`, or `yarn` installs.

## Adding Devices

The first device should create or verify the CouchDB database from inside the plugin, then run the connection check so LiveSync sync parameters exist.

After that, add devices from the original device:

1. Open Lightweight LiveSync settings on the original device.
2. Choose **Generate URI** under **Add another device**.
3. Copy the encrypted `obsidian://setuplivesync?settings=...` URI to the new device.
4. On the new device, choose **Use setup URI**, paste the URI, and enter the same shared E2EE passphrase.

The generated add-device URI does not create a database. It only carries the existing CouchDB connection settings and E2EE settings for the database already initialized by the original device.

Devices imported from a setup URI are treated as additional devices. Their connection check verifies the existing database and sync parameters but does not create the database or initialize sync parameters. If the check says sync parameters are missing, initialize them from the original device and then check the added device again.

Each device still needs three things:

1. The same CouchDB server and database.
2. A CouchDB user that is allowed to read and write that database.
3. The same vault E2EE passphrase.

The easiest path is the generated add-device URI. If you use separate CouchDB users per device, a CouchDB server admin must create those users and add them to the database `_security` members or to a member role before the plugin can sync.

The plugin does not create arbitrary CouchDB server users. That is intentional: user creation and database membership are server-side security decisions. When this plugin creates a new database itself, it attempts to restrict that database to the current CouchDB username before initializing sync parameters.

## Security

E2EE is required by default. Note content and obfuscated paths are encrypted before sync when the vault passphrase and CouchDB sync-parameter salt are available.

Use HTTPS or a trusted VPN/tunnel for CouchDB access. CouchDB Basic Authentication over plain HTTP exposes the CouchDB username and password to anyone who can observe the network. E2EE protects synced note content, but it does not protect the CouchDB account password in transit.

Recommended CouchDB server posture:

- Use a real CouchDB admin account; do not run with open administrative access.
- Keep CouchDB's default database security at `admin_only`, not `everyone`.
- For each vault database, set database `_security` members or roles explicitly.
- Give sync users only the database access they need.
- Restrict network exposure with firewall rules, a VPN, reverse proxy authentication, or LAN-only access as appropriate.
- Use TLS certificates trusted by every device that will sync.

Official CouchDB references:

- [CouchDB database security object](https://docs.couchdb.org/en/stable/api/database/security.html)
- [CouchDB security overview](https://docs.couchdb.org/en/stable/intro/security.html)
- [CouchDB HTTPS/TLS options](https://docs.couchdb.org/en/stable/config/http.html#https-tls-options)
- [CouchDB default security option](https://docs.couchdb.org/en/stable/config/couchdb.html#couchdb/default_security)

See [docs/security.md](docs/security.md) for a fuller audit checklist.

## Current Reliability Focus

The lightweight fork intentionally avoids broad startup scans and file-open sync. Sync work is coalesced through a single scheduler:

- Vault changes batch for 60 seconds by default.
- Repeated edits to the same path collapse into one queued local push.
- Unchanged saves are skipped after a matching successful-upload fingerprint.
- Each sync uploads only a bounded number of local changes.
- The engine yields between queued uploads, and the no-worker fallback yields before and during larger main-thread bundle builds.
- Pulled CouchDB changes are cached locally in small batches instead of one large IndexedDB transaction.
- Pull apply yields around reconstruction and vault writes while still applying one file at a time.
- Failed uploads use capped backoff and do not block other due changes.
- Automatic sync pauses without contacting CouchDB when the device runtime reports offline; manual sync can still be used as an explicit retry.
- Remote applies happen one file at a time with recovery backups.
- Status messages are held briefly to avoid flicker.

The plugin also records last-sync workload metrics: phase timings, local bytes read, chunk docs built, remote docs written/reused, pulled changes, applied/merged files, backups, and unresolved conflict counts.

## Build

```sh
npm install
npm run typecheck
npm test
npm run build
```

Or run the full local gate:

```sh
npm run check
```

`npm test` runs the root-safe harness suite for setup URI/QR compatibility, direct CouchDB setup behavior, connection role checks, credential/session cache safety, runtime desktop/mobile capability reporting, runtime evidence report redaction, desktop-only API safety, scheduler backoff, sync engine batching, worker fallback, reconstruction, text merge, status presentation, and bundle shape. Live CouchDB credential tests should be run separately with local environment variables and should not store credentials in source files.

The GitHub Actions workflow runs the same `npm run check` gate for pushes and pull requests.

Build and verify a release folder plus zip:

```sh
npm run package
```

Release files are:

- `manifest.json`
- `main.js`
- `sync-worker.js`
- `styles.css`

Before claiming mobile support is fully verified, run the device checklist in [docs/mobile-runtime-checklist.md](docs/mobile-runtime-checklist.md) on a real iOS or Android Obsidian install.

For release auditing, see [docs/verification-matrix.md](docs/verification-matrix.md). For the remaining real-device mobile proof, use [docs/mobile-evidence-template.md](docs/mobile-evidence-template.md).
