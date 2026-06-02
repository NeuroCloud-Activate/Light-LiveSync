# Light-LiveSync

Light-LiveSync is an Obsidian sync plugin with a simple goal: keep your vault synced through your own CouchDB server without making Obsidian feel heavy.

It is a fork-inspired rebuild of [Self-hosted LiveSync](https://github.com/vrtmrz/obsidian-livesync). The original plugin proved that CouchDB-backed Obsidian sync can be powerful, but it also accumulated a lot of options, rough edges, bugs, and performance issues for people who mostly wanted one thing: reliable live sync. This plugin focuses on doing that one job as cleanly as possible.

## What It Does

- Syncs Obsidian notes through a self-hosted CouchDB backend.
- Keeps compatibility with the familiar `obsidian://setuplivesync?settings=...` setup URI flow.
- Requires end-to-end encryption by default.
- Batches edits for 60 seconds by default so rapid typing does not spam the server.
- Scans the current vault when you press **Sync now**, so first-time uploads do not depend on fresh edit events.
- Automatically scans and queues the current vault on first setup/startup sync when the remote vault is empty.
- Includes vault configuration, hidden files, and other plugin data in manual full-vault sync.
- Restores saved credentials automatically on app start so mobile sync can resume without a repeated credential prompt.
- Syncs vault configuration and plugin data along with notes.
- Uses periodic sync as a fallback when mobile backgrounding or missed file events get in the way.
- Automatically merges ordinary text edits and keeps recovery backups.
- Keeps the status UI calm, small, and out of your way.
- Includes runtime checks and a non-secret evidence report for troubleshooting.

The short version: this is meant to feel boring in the best way. Set it up, let it sync, and stop thinking about it.

## Built With Codex

This project was built collaboratively with AI assistance through OpenAI Codex. The design, implementation, auditing, and test coverage were guided through an iterative human-plus-AI development workflow.

## Why This Fork Exists

Self-hosted LiveSync is feature-rich, but that breadth can also make it harder to debug, harder to configure, and easier to hit performance problems. Light-LiveSync intentionally narrows the scope.

The focus here is:

- Fewer moving parts.
- Fewer settings to worry about.
- Less network chatter.
- Less CPU-heavy work on the main Obsidian thread.
- Better defaults for poor connections and mobile devices.
- A setup flow that explains what it is asking for.
- A sync engine that prioritizes reliability over cleverness.

This is not trying to replace every advanced feature from the original plugin. It is trying to make the core live-sync experience fast, understandable, and dependable.

## Compatibility

Light-LiveSync keeps the same CouchDB-style backend approach used by Self-hosted LiveSync. It is intended to work with existing self-hosted CouchDB deployments, including common Docker-based CouchDB setups.

It supports:

- CouchDB server URL, database, username, password, and optional custom headers.
- Plain IP or host entries are cleaned up automatically by adding `http://`; HTTPS domains stay HTTPS.
- Existing Self-hosted LiveSync setup URI imports.
- In-plugin direct setup using the same familiar fields: `hostname`, `database`, `passphrase`, `username`, and `password`.
- Add-device setup URI generation from an already configured first device.
- HKDF-encrypted synced content and path obfuscation.
- Desktop and mobile Obsidian loading; the manifest is not desktop-only.

The bundled plugin is self-contained. Obsidian desktop and mobile devices do not need to install `npm`, `pnpm`, `yarn`, or any separate dependencies.

## Setup

The setup process is guided inside the plugin. The fields are described where you enter them, so you do not have to memorize the original setup script or decode what each value means.

For the first device:

1. Open Light-LiveSync settings.
2. Choose **Prepare command**.
3. Enter the CouchDB values configured in your server-side CouchDB instance: Server Domain, Database Name, Database User, and Database Password.
4. Enter the shared Vault E2EE Passphrase that will encrypt synced vault content.
5. Copy the setup command, run it on the CouchDB host, then paste the printed setup URI into **Use setup URI**.

Use **Copy setup command** in the setup screen. Run the copied command directly on the CouchDB host where the server-side CouchDB instance is reachable, such as your server terminal, SSH session, or Docker container console. It runs this repo's hosted helper script:

```sh
deno run -A https://raw.githubusercontent.com/NeuroCloud-Activate/Light-LiveSync/main/utils/couchdb_setupuri.ts
```

The copied command maps the setup form to the setup URI fields: Server Domain becomes `hostname`, Database Name becomes `database`, Database User becomes `username`, and Database Password becomes `password`. The Vault E2EE Passphrase becomes `passphrase`. If you are creating a new database user or database, also replace `admin_username` and `admin_password` with an existing CouchDB admin. The helper creates or updates the database user, creates or verifies the database, prepares LiveSync sync parameters, restricts database access to that database user, verifies that database user can read the database, and prints a setup URI that can be pasted back into **Use setup URI**.

When importing the setup URI, paste the `obsidian://setuplivesync?settings=...` line. If you copied the full terminal output from the helper, Light-LiveSync will find the setup link inside it.

For another device:

1. On the original device, open Light-LiveSync settings.
2. Choose **Generate URI** under **Add another device**.
3. Copy the encrypted `obsidian://setuplivesync?settings=...` URI to the new device through a trusted channel.
4. On the new device, choose **Use setup URI**.
5. Enter the same shared E2EE passphrase.

Additional devices verify the existing database and sync parameters. They do not create the database or initialize sync parameters. That keeps database creation anchored to the first device and your CouchDB server permissions.

Each device still needs:

- Access to the same CouchDB server and database.
- A CouchDB user allowed to read and write that database.
- The same vault E2EE passphrase.

The plugin itself does not create CouchDB users from inside the app. User/database creation happens only through the copied server-side helper command when you provide an existing CouchDB admin, which keeps that administrative step explicit.

## Security

Security is a core part of the design, not an advanced mode.

- E2EE is required by default.
- Raw CouchDB passwords and raw E2EE passphrases are blanked before settings are saved.
- Saved credentials are stored in an encrypted local credential store and stay available on the same device after setup, relying on the device itself for access protection.
- Synced note content is encrypted before it reaches CouchDB.
- Path obfuscation is enabled by default.
- Add-device setup URIs are encrypted and should be treated like temporary invite codes.
- Light-LiveSync keeps its own volatile runtime data and generated preview/staging/conflict folders local-only so sync does not loop on its own changing state.

Use HTTPS, a trusted VPN, or another protected network path for CouchDB. Vault E2EE protects note content, but CouchDB Basic Authentication over plain HTTP can still expose the CouchDB username and password on the network.

Recommended CouchDB posture:

- Use a real CouchDB admin account.
- Do not expose CouchDB with open administrative access.
- Keep database access restricted with `_security` members or roles.
- Give sync users only the access they need.
- Avoid public exposure unless protected by TLS, VPN, firewall rules, or a reverse proxy.

## Lightweight Sync Design

The plugin is optimized around minimal work and minimal data movement.

- Edits batch for 60 seconds by default.
- Multiple edits to the same file collapse into one queued push.
- Unchanged saves are skipped after a matching upload fingerprint.
- Each sync can upload a large batch of changed files by default, which helps first syncs and full-vault updates finish quickly.
- Large work yields back to Obsidian so the app can stay responsive.
- A background worker is used when available, with a cooperative main-thread fallback.
- Pulled CouchDB changes are cached locally in small batches.
- Remote changes apply one file at a time with recovery backups.
- Failed uploads use capped backoff and do not block unrelated due changes.
- Automatic sync pauses when the runtime reports offline.
- Periodic sync acts as the fallback safety net.

This is the heart of the plugin: sync reliably, use less data, and avoid turning background sync into the thing you notice.

## Poor Connections

The plugin is designed to be patient with unstable networks.

- It avoids repeated large transfers when the device is offline.
- It keeps queued work local until sync can safely retry.
- It uses bounded retries instead of tight retry loops.
- Manual sync remains available when you want to force a retry.
- Runtime status and evidence reports help confirm whether queues are settled.

## Build And Test

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

`npm test` covers setup URI and QR compatibility, direct CouchDB setup behavior, connection role checks, encrypted credential handling, session cache safety, desktop/mobile runtime reporting, evidence report redaction, scheduler backoff, sync batching, first-upload handling, vault scan rules, worker fallback, reconstruction, text merge, status presentation, and bundle shape.

Build and verify a release folder plus zip:

```sh
npm run package
```

Release files are:

- `manifest.json`
- `main.js`
- `sync-worker.js`
- `styles.css`

## Mobile Testing

The plugin is built to load on Obsidian desktop and mobile, but real mobile sync should still be tested on a real iOS or Android device before you rely on it everywhere.

For a practical mobile check, install the release build on the device, import the setup URI, create and edit a few notes, sync in both directions, close and reopen the app, and confirm sync resumes without a repeated credential prompt. Record only non-secret observations: device type, Obsidian version, plugin version, connection type, sync result, and whether queues returned to zero.
