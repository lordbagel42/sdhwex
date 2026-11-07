# sdhwex Manager — Executor app

Private, tool-based administration for the existing Cloudflare JSON feed. No new extension build is needed for data changes.

- App: `app_8c22462c-e6a5-40fc-8ce2-a670f55f30c2`
- Executor namespace: `sdhwex-manager`
- Feed: https://sdhwex-data.enderium42.workers.dev/v1/triage.json
- Cloudflare target: `sdhwex-data` in the existing account; neither target nor executable source is a tool argument.

## Use through Executor

Ask an agent connected to Executor, for example:

> Use sdhwex Manager to show build project 44495's failed checks and warnings.

> Change the design-stage warnings for project 55399 to [the replacement warnings], preserving its failed checks.

> Replace the shipping-guidelines sentence with [new text].

The agent reads `status` or `getProject`, then passes the returned `feedHash` as `expectedHash` to an update. **Remote writes execute immediately without an additional approval prompt.** Authentication, input validation, backups and stale-write checks remain enabled. `updateReasons` replaces only the supplied fail/warn/verdict fields; omitted fields remain unchanged and `[]` clears a list. Wording is plain text, never executable code. Dates stay unchanged unless an entire snapshot is explicitly replaced using the report's actual check date.

Tools:

- `status`, `listProjects`, `getProject`, `exportFeed`: live reads.
- `updateReasons`, `upsertProject`, `removeProject`: project changes in one explicit `build` or `design` stage.
- `replaceSnapshot`: replace a stage with `{checkedAt, projects}` JSON; leaves the other stage and guidelines alone.
- `updateGuidelines`: change the sentence used by feedback drafts and the rejection helper.
- `history`, `getPublication`: publication results and backup IDs.
- `restore`: publish the complete feed saved **before** a selected publication, guarded by the current live hash.
- `resolvePending`: inspect an uncertain/interrupted publication and release its lock without replaying an upload.

Installed extensions check for updates every five minutes; allow about six minutes including propagation. A successful publication reports Cloudflare acceptance, not immediate refresh of every browser. Recently published data must be visible before a subsequent write can proceed.

## Safety and recovery

The app validates the extension's schema, limits feed size to 750000 bytes, serializes its own publications with a persistent SQLite lock, and saves full before/after data. Stale hashes are rejected. A timeout or uncertain API result retains the lock instead of retrying. `resolvePending` compares live content with both saved hashes; an interrupted active operation must be five minutes old before recovery. It never repeats a write. Backups are private app data and are retained until the app is removed.

Cloudflare does not supply an atomic feed compare-and-swap here. The app checks immediately before upload but cannot prevent an outside writer from racing it. Route edits through this app rather than concurrent dashboard/CLI deployments. Restoring a backup affects both stages and guidelines; take that full scope into account before calling restore.

The app reuses the same provider definition as the existing Cloudflare API app. Your account is linked in **user scope**, not shared with every caller. Credentials stay in Executor and are injected only into the declared header on `api.cloudflare.com`. No credentials are stored in source or publication history.

## GitHub and offline fallback

Remote edits do **not** rewrite GitHub or the ZIP's bundled offline snapshot. `exportFeed` returns the complete current feed for reconciliation. Save `feed.build` to `data/snapshot.json`, `feed.design` to `data/design-snapshot.json`, and the remaining configuration to `data/remote-config.json` before using the old local `npm run deploy:data` flow, or it will overwrite live changes with your local files. Code changes still require a rebuilt/reloaded Chrome extension.

## Maintain this app

`package.json` pins the deployed host's exact `apps` version. Install locally with `npm install --no-package-lock --ignore-scripts`, then run `npm run typecheck`. Do not deploy `node_modules` or compiled verification files.

For hosted CLI use, sign in with `npx executor@beta apps login --host https://api.executor.sh`, then use the same host and this app ID. Read working source and its Git revision before modifying an already-deployed app; commit the complete source file list against that revision, then deploy the new commit. The authenticated MCP management tools support the same workflow.

Verification: strict TypeScript check; live status/project/search/history tool calls; mocked publication checks for validation, no-op writes, stale hashes, fixed-target uploads, backups, uncertainty locking and recovery without replay. No production findings were changed during verification. This app exposes tools, not a custom web UI.
