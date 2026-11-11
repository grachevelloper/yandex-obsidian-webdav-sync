# Contributing

Use Node.js 24 and a separate task branch and worktree. Install dependencies with
`npm ci`, then run `npm run check` before submitting changes. This checks formatting,
the official Obsidian lint rules, behavior tests, TypeScript types and the
browser-compatible plugin build. The build runs `npm run test:bundle` against the
actual emitted `main.js` in an isolated browser-like context without Node globals.
This verifies module loading, plugin initialization and the WebDAV connection
check. `npm run lint` rejects warnings as well as errors.

`npm run lint:community` runs the official Obsidian rules pinned to 0.4.2, which
reproduce the two unsupported-API findings and four DOM-helper warnings from the
1.0.3 Community scorecard. `npm run lint:recommended` also runs the newer rules.
Both run in CI. The rules cover source analysis; they do not reproduce the entire
hosted scorecard or its unavailable malware and network scans. See the official
[scanner configuration](https://github.com/obsidianmd/eslint-plugin/blob/master/docs/configuration.md#community-plugin-scanner-configuration).

Tagged releases are checked and built in `Release build`. The tag must match the
manifest version. The workflow signs provenance attestations for all three plugin
files before uploading the build. Publish those exact files and verify them with
`gh attestation verify <file> --repo grachevelloper/yandex-obsidian-webdav-sync`.

The dependency overrides keep scanner dependencies on patched minimatch and moment
versions (GHSA-g3hv-75wg-m249 and GHSA-4p3w-j4w9-5jqw). Remove them when the
upstream scanner dependencies require patched versions themselves.

Follow [AGENTS.md](AGENTS.md). Extend the existing tests for the behavior you change.
Runtime code must work on desktop, Android and iOS without Node.js or Electron APIs.
Preserve conflict versions and recovery copies, and never overwrite a file changed
after it was read. Destructive actions require a confirmed sync preview.

For device and WebDAV verification, use the [manual checklist](docs/manual-testing.md)
with disposable vaults. Do not include credentials, private notes, local `data.json`
or unredacted diagnostic logs in an issue or pull request.

## Test layout

Tests are grouped by the behavior they cover:

- `tests/sync`, `tests/webdav`, `tests/vault`, `tests/shared`, `tests/settings`,
  `tests/i18n` and `tests/logging`: behavior tests, run with `npm test`.
- `tests/ui`: UI behavior in a simulated DOM, also run with `npm test`.
- `tests/helpers`: shared DOM setup and the simulated Obsidian API.
- `tests/runtime`: checks of the built plugin, run with `npm run test:bundle`
  after building. `npm run build` includes these checks.
- `tests/e2e`: Playwright tests in real Obsidian, run with `npm run ui:e2e`.
  `helpers` contains the isolated host and synthetic data; `__screenshots__` contains
  reference PNGs used by assertions. Keep those PNGs in version control.
- `tests/e2e/gallery`: captures and displays synthetic UI states for manual
  inspection, using `npm run ui:capture` and `npm run ui:gallery`.

`scripts` contains repository commands only. Generated screenshots, comparison
failures, logs and isolated gallery profiles belong in the ignored `.artifacts/`
directory and can be removed after stopping the capture or gallery server.

## UI gallery in real Obsidian

The gallery captures the production UI classes inside a separate installed
Obsidian instance, using its real Modal, Setting and ProgressBar components and
its current default theme. This avoids a browser mock drifting away from Obsidian.
Storybook is not required. Playwright controls the app through a local debugging
connection and Obsidian's documented `app.emulateMobile()` mode.

On macOS with Obsidian installed:

```sh
npm run ui:capture
open .artifacts/ui-gallery/index.html
```

The gallery opens directly in your browser. Keep `index.html` and `screenshots/`
together if you move it. For HTTP access, run `npm run ui:gallery` and open
[the local address](http://127.0.0.1:4783) while that command is running.
Choose a stage, theme and viewport, or compare all sizes. Switch to “После
прокрутки” to inspect the bottom of long windows. The capture covers 36 scenarios at 370 × 800, 420 × 900 and
1440 × 1000 in light and dark themes (216 PNGs). It includes connection settings,
mode selection, listing/comparison, previews, mirror deletions, individual files,
conflict tabs and editing, loading/failure states, transfers, retries, stopping,
reports and logs. Long paths and a 150-file list exercise narrow layouts.

All files, accounts and errors are synthetic. The harness starts no sync transport
and uses only `.artifacts/ui-gallery/vault` and `.artifacts/ui-gallery/profile`.
It never opens a personal vault. It disables updates in this isolated profile,
records the running Obsidian version and source commit, fixes time for stable
labels, and saves layout measurements and page errors to `manifest.json`.
The gallery output stays under `.artifacts/ui-gallery/`.

Overrides:

```sh
OBSIDIAN_EXECUTABLE=/path/to/Obsidian npm run ui:capture
UI_SCENARIOS=preview,conflict-result UI_DEVICES=phone-370 UI_LANGUAGE=en npm run ui:capture
UI_PORT=4784 npm run ui:gallery
```

A filtered capture replaces the gallery manifest with that subset. Run the full
capture again to restore all scenarios. Capture one instance per worktree at a
time; stop the gallery server before deleting its artifacts. Other operating
systems can supply an executable path, but this harness has been verified on
macOS only. Mobile emulation uses Obsidian's mobile UI in desktop Chromium; it does
not validate the iOS WebKit engine, Android integration, safe areas, the software
keyboard or physical touch. Test those on real devices before a release.

References: [Obsidian mobile development](https://docs.obsidian.md/Plugins/Getting%20started/Mobile%20development),
[Playwright screenshots](https://playwright.dev/docs/screenshots).

### Playwright end-to-end tests

Run `npm run ui:e2e` to test the real plugin in an isolated Obsidian vault on all
three viewport sizes. Playwright clicks the settings and sync controls, verifies
connection success and an authentication error, and follows an upload from mode
selection through preview confirmation to the report. The fixture supplies WebDAV responses without contacting Yandex Disk. The test
instance launches in the background on macOS.

`toHaveScreenshot` compares the connection row and sync dialogs with the PNGs
in `tests/e2e/__screenshots__/`. The snapshots use the default light theme
in Obsidian 1.14.4 on macOS. The elapsed timer and report timestamp are hidden
for comparison. Match the reference environment when updating the PNGs:

```sh
npm run ui:e2e -- --update-snapshots
```

Review the PNG changes along with the code. A normal run leaves the reference
PNGs untouched and saves image diffs under `.artifacts/ui-e2e/results/` if a
comparison fails.
