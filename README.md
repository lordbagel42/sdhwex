# sdhwex

A Chrome extension with Cloudflare-hosted JSON findings, reasons, warnings and feedback wording, plus a bundled offline fallback. The separate Tampermonkey userscript uses the bundled snapshot only.

It detects the project ID from `https://stardance.hackclub.com/admin/certification/hardware/<ID>` and inserts an extra **Design queue triage** or **Build queue triage** card at the top of the project details column. Version 1.3.0 bundles 175 design and 237 build projects and refreshes Chrome findings from Cloudflare automatically.

## Cloudflare data updates

Use the **sdhwex Manager** Executor app to edit reasons, warnings, project records, snapshot data and shipping-guidelines wording with approvals and publication backups. See [`executor-app/README.md`](executor-app/README.md). Remote edits update installed extensions automatically but do not rewrite the bundled GitHub JSON; export/reconcile the live feed before publishing from local files.

The Chrome extension reads `https://sdhwex-data.enderium42.workers.dev/v1/triage.json` on page load and every five minutes while the page remains open. It validates JSON and caches it locally, retaining the last valid cache or bundled data if Cloudflare is unavailable. The card labels its source and last successful fetch time. The entire feed is downloaded: no project ID, page content, justification, cookies or authentication tokens are sent to the Worker. Cloudflare still receives normal connection metadata such as your IP address.

To change reasons/findings, edit `data/snapshot.json` (build) or `data/design-snapshot.json` (design). Edit `data/remote-config.json` to change the shipping-guidelines sentence. Preserve the schema and use each report's actual check date. With an authenticated Cloudflare Wrangler CLI installed, run:

```sh
npm run deploy:data
```

This validates and publishes the JSON feed via the `sdhwex-data` Cloudflare Worker. **Installed extensions pick up data changes without a new ZIP or reinstall.** The Worker has no public write endpoint. Snapshot JSON is public, like this repository. Allow about a minute for Cloudflare propagation plus the five-minute extension refresh interval.

Executable JavaScript/styles stay bundled. Manifest V3 does not support remotely hosted executable extension code. Code changes require a new build/reload, or Chrome Web Store updates if published; this project does not bypass that restriction.

`npm run build` produces `dist/sdhwex-chrome.zip` (and the legacy ZIP filename), and generates `cloudflare/worker.js` from the JSON files and `cloudflare/handler.js`. The userscript remains offline-only.

## Install in Chrome (no build needed)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked**.
3. Select this folder:
   `dist/chrome` inside your `sdhwex` checkout
4. Reload your Stardance tab. Open a hardware review, or navigate there from the queue.

For moving to another computer, extract `dist/sdhwex-chrome.zip` and load the extracted folder containing `manifest.json`. Chrome does not load the ZIP directly.

**Updating an existing installation:** click **Reload** on the extension in `chrome://extensions`, then reload Stardance. The folder has not changed.

The extension has no browser-toolbar popup; its card and helper button appear inside the review page. Remove it through `chrome://extensions`.

## Alternative: Tampermonkey

1. Install Tampermonkey and enable user scripts for it in Chrome if prompted.
2. Choose **Create a new script** in Tampermonkey.
3. Replace the editor contents with the entire file `dist/stardance-triage.user.js` and save.
4. Reload Stardance.

If you already installed the previous userscript, replace the contents of that existing script with the rebuilt file instead of installing a second script. Its display name is **sdhwex**.

Use either the Chrome extension or the userscript, not both.

## What the card includes

- The snapshot verdict, project title and ID, and submission date.
- **Design:** funding tier and requested USD amount (and BOM total if supplied). No build devlog counts or demo link: the design export's `demo` field contains an amount, not a URL.
- **Build:** build/total devlogs and repository/demo links. Design cards link to the repository only.
- Every failed check and warning from the original data, unchanged. Design methodology explicitly notes that build-only requirements were skipped.
- **Copy feedback draft**, with the appropriate design/build approval wording and failed checks only. Warnings are not included. Both drafts end exactly: `Please refer to https://codex.hackclub.com/shipping/101/ for the full shipping guidelines.` If clipboard access is denied, a selectable text box appears.
- Snapshot date, methodology, and explicit reminders that findings need human verification.
- An explicit “not in this snapshot” state for unknown projects, never a fabricated pass or fail.

For `44495`, the build snapshot contains **3d printer live view**, five failed checks, and seven build devlogs. For `55399`, the design snapshot contains **SAMMY-a wireless morse code communicator**, two failed checks, one warning, tier B, and a $25.00 request.

## Permanent-rejection popup helper

The existing **Permanently reject project** / **Nominate for permanent rejection** dialog now has an **Insert shipping guidelines** button directly below **Justification**. Place the cursor in that textarea, then click the button (or Tab to it and press Enter/Space). It inserts exactly:

> Please refer to https://codex.hackclub.com/shipping/101/ for the full shipping guidelines.

The sentence is inserted at the cursor, replacing selected text if any, without adding extra whitespace. Other text stays intact; focus returns to the textarea with the caret after the sentence. The helper respects readonly/disabled fields and the character limit, never truncates the sentence, and never submits or confirms a rejection. It works independently of snapshot coverage. The separate permanent-rejection page is not modified—only the hardware-review popup.

## Important limitations and privacy

**These are static snapshots, not live checks.** Both supplied reports label their check date **November 4, 2026**. The build report has 237 projects (204 “Not shipped”, 33 “Looks ready”); the design report has 175 (119 “Not shipped”, 56 “Looks ready”). The dates and findings are preserved, not independently verified. Repositories and projects may have changed. “Looks ready” is not an approval. Verify draft feedback against the current evidence before sending it.

The Chrome extension fetches only the fixed Cloudflare JSON endpoint through its background worker, without credentials or referrer. It never downloads executable code, reads no authentication tokens or cookies, and sends no review/page data. Styles and offline fallback findings are bundled locally. The userscript makes no network requests. Opening repository/demo links is a normal user-initiated navigation. It never submits, approves, rejects, or claims a review. It only edits the justification textarea when you explicitly click **Insert shipping guidelines**; it never fills review forms automatically.

Chrome content-script access is limited to `https://stardance.hackclub.com/*`. The extension also has local-storage permission and network access to `https://sdhwex-data.enderium42.workers.dev/*`. That origin-wide content-script match is intentional: Stardance uses Turbo, so the script must already be present when you enter a review from the queue without a full page load. Card insertion itself is limited to the numeric hardware-review URL and the known hardware details column. The background worker fetches and validates JSON only. There are no remote scripts, external fonts, telemetry, or Cloudflare credentials in the extension.

## Stardance integration

The insertion point was checked against [`hardware_reviews/show.html.erb`](https://github.com/hackclub/stardance/blob/main/app/views/admin/certification/hardware_reviews/show.html.erb):

```css
.hardware-review .ship-review__details
```

**Stage selection:** design and build reviews share the same URL. The current header's **Design funding** / **Build certification** tag takes priority, followed by the back-to-queue link. Only that stage's snapshot is used, even if the project exists in the other snapshot. A missing record is explicitly unknown. If neither page signal exists, a unique project-ID match is used with a visible stage-inference warning; overlapping IDs show no findings until the page stage can be detected.

The host inherits the native `ship-review__panel` appearance. Its contents use a shadow root to avoid changing Stardance's styles or being changed by broad site selectors. The decision and claim controls are untouched; the only added form control is the explicitly requested insertion helper in the permanent-rejection dialog.

Turbo page/frame renders, back/forward navigation, cached pages without shadow roots, and URL-only history changes are handled without duplicate cards. Before Turbo caches a page, the card is removed and later rebuilt. If Stardance changes these layout selectors, update `src/content.js`; the script deliberately does not inject into arbitrary page areas.

## Develop / update the snapshot

Node.js 20+ is sufficient. Runtime artifacts have no dependencies; jsdom is used only for development tests.

```sh
npm ci
npm run build
npm test
```

To import a newer report, extract its HTML or JSON, then supply the **report's actual check date** and stage (defaults to `build`):

```sh
npm run import -- /absolute/path/to/build-queue-triage.html YYYY-MM-DD build
npm run import -- /absolute/path/to/design-queue-triage.json YYYY-MM-DD design
npm run build
npm test
```

The importer parses and validates the JSON array (or the HTML's JSON `DATA` array) without executing report scripts. Each stage updates only its own snapshot. After rebuilding, click **Reload** on the Chrome extension and reload Stardance. For Tampermonkey, replace the installed script with the rebuilt userscript. The packaged ZIP must also be regenerated if distributing an update.

Files:

- `data/snapshot.json` — original build project records plus the report's check date.
- `data/design-snapshot.json` — original design project records plus its check date.
- `src/content.js` — URL detection, card rendering, clipboard handling and lifecycle.
- `src/card.css` — isolated card styles using Stardance theme variables.
- `scripts/build.mjs` — emits identical logic/data for Chrome and Tampermonkey.
- `test/content.test.mjs` — build record coverage, routing, security, copy and Turbo tests.
- `test/design.test.mjs` — design record coverage, funding metadata, stage selection, navigation, feedback and bundle-parity tests.
- `test/rejection.test.mjs` — insertion positions, selections, focus, events, character limits, disabled fields, popup scope and Turbo tests.
- `test/permanent-rejection.html` — labeled visual fixture for the native popup.
- `test/hardware-review.html` — explicitly labeled visual fixture using the inspected Stardance selectors; not a copy of an authenticated review.

Historical verification (v1.2.0, before Cloudflare support): 37 automated tests passed, including rendering all 237 build and 175 design records. The bundled script was also checked in Chromium against build and design fixtures at desktop (1440px) and mobile (390px), including clipboard success and preservation of the existing review draft. The permanent-rejection popup helper was also checked in a Chromium fixture at both sizes: insertion preserved surrounding text, restored the caret, and did not submit. The authenticated production review page and an installed Tampermonkey instance were not exercised.
