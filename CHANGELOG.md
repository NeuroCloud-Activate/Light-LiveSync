# Changelog

## 0.1.1

- Restores saved sync credentials automatically on app start for smoother mobile use.
- Normalizes CouchDB addresses more carefully while preserving HTTPS domains.
- Raises the default upload batch size for full-vault first syncs.
- Allows vault configuration and plugin data files to sync.
- Runs runtime checks automatically and simplifies the settings screen into sync, activity, and advanced pages.

## 0.1.0

- Initial Light-LiveSync release.
- Adds guided CouchDB setup, setup URI import, and add-device URI generation.
- Requires encrypted sync by default with local encrypted credential storage.
- Batches edits for low network use and uses periodic sync as a fallback.
- Includes automatic text merge, recovery backups, runtime checks, and release verification.
