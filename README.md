# gracheveloper's-webdav-sync

A personal-use Obsidian plugin by Nick Grachev for manual, two-way sync of notes and attachments with Yandex Disk over WebDAV.

The plugin runs inside Obsidian. No backend, database server or hosting is needed. Each device keeps a normal local vault and exchanges files with a dedicated Yandex Disk folder when you run sync. There is no background service.

## Features

- Watch file checks and transfers in a compact progress window with processed/total counts, active files, elapsed time and retry countdowns. Hide and reopen the window without starting a second run; preview confirmation and the final report stay in the same window.
- Prepare a read-only preview from the ribbon button, the **Preview sync with Yandex Disk** command or plugin settings.
- Browse a compact file tree with collapsible folders and an action column. Unchanged files are hidden by default and can be shown. The total counts each path once across both devices, including skipped and failed checks.
- Confirm the plan before applying file changes. Review uploads, downloads, exact conflict-copy names and skipped files, or cancel without transfers. No remote folders are created during preview.
- Files changed after preview are skipped with an error; prepare a new preview to approve their current versions. Files added after preview wait for the next run.
- Exchange Markdown notes, images and other attachments while preserving folders.
- Compare SHA-256 content hashes with the last synchronized state, independently of device clocks.
- Preserve conflicts on both sides: the cloud version keeps the original name; the local edit becomes `name.conflict-<SHA-256>.extension` beside it. The report shows both paths. Names use the available UTF-8 filename byte budget; ordinary extensions are preserved.
- Do not propagate deletions. A file missing on one side is restored from the other. Renaming currently creates a new file and restores the old name.
- Stop before transfers if file/folder names collide by case or Unicode normalization.
- Review a responsive report with upload/download totals, conflicts, skipped files and errors.
- View local diagnostic logs from the report, plugin settings or **Open latest sync log** command. Logs survive restarts, contain file paths and HTTP statuses, and exclude passwords, authorization headers and file contents.

The source repository is [self-obsidian-webdav-sync](https://github.com/grachevelloper/self-obsidian-webdav-sync). The installed ID remains `yandex-disk-sync` to preserve existing settings. This version still connects specifically to Yandex Disk.

## Build

Use Node.js 24 and npm. Only development tools need Node.js; the installed plugin uses the Obsidian API.

```sh
npm ci
npm run check
```

Installable files are generated in `release/yandex-disk-sync/`: `main.js`, `manifest.json` and `styles.css`. The phone does not need to build them.

## Install

1. Start with separate test vaults on your computer and phone.
2. Copy the generated `yandex-disk-sync` folder into `<vault>/.obsidian/plugins/` on each device. If you changed the Obsidian configuration directory, use that directory instead of `.obsidian`.
3. Allow community plugins, restart Obsidian and enable **gracheveloper's-webdav-sync** in installed plugins. This plugin is not yet listed in the public community catalog.
4. Create a **Files WebDAV** app password in Yandex ID. In plugin settings, enter your Yandex login, that app password and a dedicated folder such as `Obsidian/Personal`. Use the same account and folder on both devices. Your plan must include WebDAV access.
5. Run sync on the first device, review the preview and choose **Confirm sync**. Wait for completion, then repeat on the second device. After editing, repeat this sequence. The command palette is available on mobile as well.

The first sync preserves both versions when existing files share a path but differ in content. An empty new vault downloads the files from Disk.

## Request limits

In plugin settings, **Concurrent requests** sets the maximum outstanding requests (1–8, default 2). **Request start interval (seconds)** independently sets the minimum time between new requests (0.1–60, default 1). At the defaults, two slow requests can overlap, but new requests start at least one second apart. The same limits apply to preview reads, uploads, downloads and retries. Higher concurrency also buffers more file data in memory.

HTTP 429 applies a shared cooldown using Retry-After and bounded backoff; it can delay requests longer than the configured interval. Repeated throttling or read network interruptions stop the run. Writes with an uncertain network outcome are not automatically retried. Rerun preview before confirming another attempt.

Independent files are processed concurrently. Access to an original and its conflict copy, shared folder creation and baseline persistence are coordinated. A fatal failure stops new file work and waits for started tasks to settle before showing the final report; already-started requests may still finish.

## Local data and limits

- Requests go directly to `https://webdav.yandex.ru` over HTTPS. No other servers, telemetry or analytics are used.
- The login, app password and sync baseline are saved in `<config>/plugins/yandex-disk-sync/data.json`. The app password is stored as plain text. This plugin excludes the configuration directory from sync; other backup tools may still copy it.
- Hidden files and directories, including `.obsidian`, `.trash` and `.git`, and a custom configuration directory are excluded. Obsidian settings and plugins are not synchronized.
- Files over 50 MiB are skipped and listed in the report. Files and HTTP responses are buffered in memory. Large vaults will sync slowly: preview reads file contents on each run. After confirmation, files requiring a transfer are read again to check that the plan is still current. The preview keeps hashes rather than file contents in memory.
- Existing remote files are written with `If-Match` and a strong ETag; new files use `If-None-Match: *`. A changed-file response rejects that write. Verify conditional request behavior with the actual Yandex WebDAV server before using an important vault.
- Markdown uses atomic `Vault.process` with an expected-content check. Obsidian has no equivalent atomic binary replacement API: attachments are rechecked before writing, but a small race window remains. Do not edit attachments with another program during sync.
- Replaced local bytes are backed up to `<config>/plugins/yandex-disk-sync/recovery/<SHA-256>`. Recovery copies stay local and are not automatically removed. To restore one, copy it and restore the original extension.
- Logs are saved under `<config>/plugins/yandex-disk-sync/logs/`. The last 10 runs and `latest.json` are retained. Each run contains at most 2,000 events; the number of omitted events is recorded. Logs may contain private file names, so review them before sharing. A run saved as `running` was interrupted before a final report could be written.
- Sync state persistence failure stops the run. An incomplete preview blocks confirmation. After confirmation, a single file transfer failure appears in the report while other approved files continue. Rerunning sync compares actual contents again.
- Run sync with Obsidian open. Do not run several Obsidian instances against the same local folder.

TODO(next verification PR): remove this temporary verification status after running the [real-device checklist](docs/manual-testing.md) against Yandex Disk and the target desktop/mobile devices. Automated tests currently use simulated WebDAV and Vault APIs; actual server behavior and device integration remain unverified.

## Project layout

```text
src/
  sync/       preview planning, decisions, execution, snapshots and shared sync types
  webdav/     HTTP client, folder traversal, XML, protocol constants and write validation
  vault/      local file access and recovery copies
  logging/    bounded diagnostic records and local retention
  settings/   connection settings and local sync state
  ui/         preview confirmation, report and log viewer
  shared/     path validation and object guards
  main.ts     plugin lifecycle and sync orchestration
tests/        mirrors source responsibilities
scripts/      development tools
```

Use `npm test` for behavior tests, `npm run format` to format, and `npm run check` for formatting, tests, types and the plugin build.
