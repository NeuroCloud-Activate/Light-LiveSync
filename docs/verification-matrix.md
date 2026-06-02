# Verification Matrix

This matrix maps the main project requirements to current evidence. It is intended to prevent release decisions from relying on memory or broad claims.

## Status Key

- **Verified**: covered by source inspection, automated tests, release checks, or completed live desktop/CouchDB testing.
- **Partially verified**: covered by automated or desktop checks, but still missing real device evidence.
- **Pending external proof**: requires a real mobile Obsidian runtime or deployment-specific server audit.

## Requirements

| Requirement | Status | Evidence |
| --- | --- | --- |
| Separate plugin line, not the upstream plugin | Verified | `manifest.json` uses `lightweight-livesync`; release zip contains only this plugin's four release files. |
| Same CouchDB backend compatibility | Verified | `tests/couchdb-transport-harness.mjs`, `tests/connection-verifier-harness.mjs`, and the private live CouchDB encrypted round-trip harness. |
| Existing setup URI intake | Verified | `tests/setup-qr-harness.mjs` and setup URI import paths in `src/setup-uri.ts` and `src/setup-qr.ts`. |
| Additional-device setup URI generation | Verified | `tests/setup-uri-export-harness.mjs`; generated URI uses `obsidian://setuplivesync?settings=` and imports as an additional device. |
| Initial-device database creation from inside plugin | Verified | `tests/direct-setup-harness.mjs` and `tests/connection-verifier-harness.mjs`. |
| Additional devices do not create or initialize databases | Verified | `tests/connection-verifier-harness.mjs`, `tests/settings-tab-harness.mjs`, and `tests/sync-engine-harness.mjs`. |
| E2EE required by default | Verified | `tests/direct-setup-harness.mjs`, `tests/setup-qr-harness.mjs`, `tests/setup-uri-export-harness.mjs`, and defaults in `src/settings.ts`. |
| Raw CouchDB password and E2EE passphrase not saved in plaintext | Verified | `tests/direct-setup-harness.mjs`, `tests/setup-qr-harness.mjs`, `tests/session-credential-cache-harness.mjs`, and release privacy scans. |
| Low-contention sync scheduling | Verified | `tests/scheduler-harness.mjs` and `tests/sync-engine-harness.mjs`. |
| 60-second default batching for vault changes | Verified | Defaults in `src/settings.ts`; sync engine and status behavior covered by `tests/sync-engine-harness.mjs` and live desktop testing. |
| Periodic sync fallback | Verified | Defaults and scheduling paths in `src/settings.ts`, `src/main.ts`, and `src/scheduler.ts`; covered indirectly by scheduler tests. |
| Poor-network tolerance and bounded retry behavior | Verified | `tests/scheduler-harness.mjs`, `tests/couchdb-transport-harness.mjs`, and `tests/sync-engine-harness.mjs`. |
| Minimal data use through coalescing/no-op suppression | Verified | `tests/sync-engine-harness.mjs` and `tests/sync-engine-stress-harness.mjs`. |
| Automatic text merge without manual conflict prompt for ordinary text notes | Verified | `tests/text-merge-harness.mjs`, `tests/live-vault-applier-harness.mjs`, and sync-engine apply tests. |
| Recovery backups before live vault apply | Verified | `tests/live-vault-applier-harness.mjs`. |
| Worker offload with main-thread fallback | Verified | `tests/sync-worker-client-harness.mjs`, `tests/sync-worker-bundle-harness.mjs`, and `tests/mobile-safety-harness.mjs`. |
| Cooperative UI yielding during heavy paths | Verified | `tests/document-reconstructor-harness.mjs`, `tests/live-vault-applier-harness.mjs`, `tests/sync-engine-harness.mjs`, and `tests/sync-worker-client-harness.mjs`. |
| Calm, small status presentation | Verified | `tests/status-presenter-harness.mjs`; settings/runtime status described in `README.md` and `docs/architecture.md`. |
| Simplified settings with plain-language guidance | Verified | `tests/settings-tab-harness.mjs`. |
| CouchDB database security hardening when plugin creates database | Verified | `tests/connection-verifier-harness.mjs`; deployment responsibilities documented in `docs/security.md`. |
| No arbitrary CouchDB server-user creation by plugin | Verified | `docs/security.md`; connection verifier restricts database membership but does not create server users. |
| Release artifact is self-contained | Verified | `npm run package` and `scripts/verify-release.mjs`; release zip contains `manifest.json`, `main.js`, `sync-worker.js`, and `styles.css`. |
| Publishable root does not contain local-only credentials or vault paths | Verified | Root privacy scans and release privacy scans. |
| Repowise indexes the promoted root source without local testing data | Verified | `repowise status --workspace` after root-only indexing. |
| Desktop Obsidian live create/edit/sync stability | Verified | Completed private desktop testing against the test vault with only the lightweight plugin enabled. |
| Credentialed encrypted CouchDB push/pull/reconstruct | Verified | Completed private live CouchDB harness using plugin code paths and E2EE reconstruction. |
| Non-secret runtime evidence report for mobile proof | Verified | `src/runtime-evidence-report.ts`; `tests/runtime-evidence-report-harness.mjs`; checklist includes the command for real-device runs. |
| Mobile-capable manifest and no desktop-only API dependencies | Verified | `tests/runtime-capabilities-harness.mjs`, `tests/mobile-safety-harness.mjs`, and `scripts/verify-release.mjs`. |
| Actual iOS/Android Obsidian sync runtime | Pending external proof | Must be completed on a real mobile Obsidian install using `docs/mobile-runtime-checklist.md` and recorded with `docs/mobile-evidence-template.md`. |

## Current Release Gate

Run this before publishing or installing the release on another device:

```sh
npm run check
```

This command performs TypeScript validation, runs the root-safe harness suite, builds the production bundle, creates the release folder and zip, and verifies the release shape.
