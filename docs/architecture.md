# Architecture

Lightweight LiveSync is a separate Obsidian plugin line that keeps compatibility with the Self-hosted LiveSync CouchDB document model and setup URI flow, while narrowing the default runtime path to quiet background sync.

## Goals

- Preserve `obsidian://setuplivesync?settings=...` setup URI import.
- Generate encrypted setup URIs from an initialized original device for adding later devices.
- Keep CouchDB server, database, username, password, headers, and transport choices user-configurable.
- Require E2EE by default for server sync.
- Batch vault changes for 60 seconds by default to reduce network and CPU churn.
- Use periodic sync as a fallback for missed file events or mobile background limits.
- Avoid file-open sync, customization sync, P2P, S3/MinIO, and broad maintenance tools in the default path.
- Keep status UI small, calm, and useful without requiring constant monitoring.

## Main Modules

- `src/main.ts`: Obsidian plugin lifecycle, commands, settings persistence, protocol handler, vault events, periodic timers, status messages, and runtime diagnostics.
- `src/settings.ts`: settings model, defaults, redaction before disk persistence, runtime-ready credential projection, and device-role state.
- `src/setup-uri.ts`, `src/setup-qr.ts`, and `src/setup-uri-export.ts`: upstream-compatible setup URI/QR import and add-device URI generation.
- `src/couchdb-client.ts`: bounded CouchDB transport with fetch by default and optional Obsidian request API mode.
- `src/connection-verifier.ts`: initial-device database creation/verification, additional-device read-only verification, sync-parameter checks, and `_security` hardening for created or existing initial-device databases.
- `src/scheduler.ts` and `src/sync-engine.ts`: single-flight sync scheduling, poor-network backoff, local push drain, remote pull caching, automatic apply, metrics, and offline gating.
- `src/livesync-document-builder.ts`, `src/document-reconstructor.ts`, and `src/document-transform.ts`: LiveSync-shaped document creation, E2EE/path obfuscation transforms, chunk handling, and reconstruction.
- `src/local-document-store.ts`: IndexedDB-backed pending push queue, remote change cache, checkpoints, and successful-upload fingerprints.
- `src/live-vault-applier.ts` and `src/text-merge.ts`: one-file-at-a-time vault apply, automatic text merge, and recovery backups.
- `src/sync-worker.ts` and `src/sync-worker-client.ts`: optional background worker for push-bundle creation, with cooperative main-thread fallback.
- `src/runtime-smoke-check.ts` and `src/runtime-capabilities.ts`: command-palette checks for installed plugin state and required desktop/mobile browser APIs.

## Sync Flow

Vault file changes are queued locally and coalesced by path. Automatic sync requests are routed through one scheduler, so startup, periodic fallback, manual sync, and vault-change batches cannot run overlapping sync loops.

Each sync cycle:

1. Confirms setup is ready and credentials are unlocked.
2. Inspects CouchDB and sync parameters.
3. Pushes a bounded batch of due local changes.
4. Pulls remote `_changes` after the local checkpoint.
5. Caches remote changes in small IndexedDB batches.
6. Applies ready remote files one at a time when automatic apply is enabled.
7. Records phase timings, queue counts, work sizes, and outcome.

Local saves that match the last successful upload fingerprint are acknowledged without rebuilding chunks or writing CouchDB documents. Failed upload items use capped backoff and do not block other due changes.

## Device Roles

Direct CouchDB setup marks the device as the initial device. It can create or reuse the database, apply `_security` hardening for the CouchDB user, and initialize LiveSync sync parameters.

Setup URI and QR imports mark the device as an additional device. Additional devices verify the existing database and sync parameters, but they do not create the database or initialize sync parameters. This keeps database creation and membership changes anchored to the original device and the CouchDB server administrator.

## Credential Handling

Raw CouchDB passwords and vault E2EE passphrases are blanked before settings are saved. The plugin stores credentials in an encrypted local credential store and restores them only after the local credential unlock passphrase is entered.

The optional session unlock cache uses Obsidian `sessionStorage` to survive renderer refreshes during the same app session. The cache is scoped to vault name, plugin id, CouchDB URI, database, and username. It is a convenience layer, not a replacement for an OS keychain.

## Performance Posture

The plugin favors small, bounded units of work:

- 60-second default batching for vault changes.
- Bounded uploads per sync cycle.
- IndexedDB writes split into small remote-change batches.
- Cooperative yields around uploads, pull caching, reconstruction, and vault writes.
- Worker-backed push-bundle creation when supported, with yielding fallback when workers are unavailable.
- Calm status presentation with a minimum visible duration.

These choices are intended to keep Obsidian responsive during live sync and to reduce data use on poor connections.

## Security Boundary

The plugin protects synced content with E2EE and avoids plaintext credential persistence, but CouchDB server administration remains outside the plugin. Server operators must configure users, password policy, HTTPS or VPN transport, firewall exposure, and database `_security` membership. See `docs/security.md`.
