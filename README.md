# self-obsidian-yandex-sync

A personal-use Obsidian plugin by Nick Grachev for manual, two-way sync of notes and attachments with Yandex Disk over WebDAV.

The plugin runs inside Obsidian. No backend, database server or hosting is needed. Each device keeps a normal local vault and exchanges files with a dedicated Yandex Disk folder when you run sync. There is no background service.

## Features

- Start sync from the ribbon button, the **Sync with Yandex Disk** command or plugin settings.
- Exchange Markdown notes, images and other attachments while preserving folders.
- Compare SHA-256 content hashes with the last synchronized state, independently of device clocks.
- Preserve conflicts on both sides: the cloud version keeps the original name; the local edit becomes `name.conflict-<SHA-256>.extension` beside it. The report shows both paths. Names use the available UTF-8 filename byte budget; ordinary extensions are preserved.
- Do not propagate deletions. A file missing on one side is restored from the other. Renaming currently creates a new file and restores the old name.
- Stop before transfers if file/folder names collide by case or Unicode normalization.
- Review a responsive report with upload/download totals, conflicts, skipped files and errors.
- View local diagnostic logs from the report, plugin settings or **Open latest sync log** command. Logs survive restarts, contain file paths and HTTP statuses, and exclude passwords, authorization headers and file contents.

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
3. Allow community plugins, restart Obsidian and enable **Yandex Disk Sync** in installed plugins. This plugin is not yet listed in the public community catalog.
4. Create a **Files WebDAV** app password in Yandex ID. In plugin settings, enter your Yandex login, that app password and a dedicated folder such as `Obsidian/Personal`. Use the same account and folder on both devices. Your plan must include WebDAV access.
5. Run sync on the first device and wait for completion, then run it on the second. After editing, repeat this sequence. The command palette is available on mobile as well.

The first sync preserves both versions when existing files share a path but differ in content. An empty new vault downloads the files from Disk.

## Local data and limits

- Requests go directly to `https://webdav.yandex.ru` over HTTPS. No other servers, telemetry or analytics are used.
- The login, app password and sync baseline are saved in `<config>/plugins/yandex-disk-sync/data.json`. The app password is stored as plain text. This plugin excludes the configuration directory from sync; other backup tools may still copy it.
- Hidden files and directories, including `.obsidian`, `.trash` and `.git`, and a custom configuration directory are excluded. Obsidian settings and plugins are not synchronized.
- Files over 50 MiB are skipped and listed in the report. Files and HTTP responses are buffered in memory. Large vaults will sync slowly: this version reads file contents on each run to compare them.
- Existing remote files are written with `If-Match` and a strong ETag; new files use `If-None-Match: *`. A changed-file response rejects that write. Verify conditional request behavior with the actual Yandex WebDAV server before using an important vault.
- Markdown uses atomic `Vault.process` with an expected-content check. Obsidian has no equivalent atomic binary replacement API: attachments are rechecked before writing, but a small race window remains. Do not edit attachments with another program during sync.
- Replaced local bytes are backed up to `<config>/plugins/yandex-disk-sync/recovery/<SHA-256>`. Recovery copies stay local and are not automatically removed. To restore one, copy it and restore the original extension.
- Logs are saved under `<config>/plugins/yandex-disk-sync/logs/`. The last 10 runs and `latest.json` are retained. Each run contains at most 2,000 events; the number of omitted events is recorded. Logs may contain private file names, so review them before sharing. A run saved as `running` was interrupted before a final report could be written.
- Sync state persistence failure stops the run. A single file transfer failure appears in the report while other files continue. Rerunning sync compares actual contents again.
- Run sync with Obsidian open. Do not run several Obsidian instances against the same local folder.

TODO(next verification PR): remove this temporary verification status after running the [real-device checklist](docs/manual-testing.md) against Yandex Disk and the target desktop/mobile devices. Automated tests currently use simulated WebDAV and Vault APIs; actual server behavior and device integration remain unverified.

## Project layout

```text
src/
  sync/       decisions, execution, snapshots and shared sync types
  webdav/     HTTP client, folder traversal, XML, protocol constants and write validation
  vault/      local file access and recovery copies
  logging/    bounded diagnostic records and local retention
  settings/   connection settings and local sync state
  ui/         report and log viewer
  shared/     path validation and object guards
  main.ts     plugin lifecycle and sync orchestration
tests/        mirrors source responsibilities
scripts/      development tools
```

Use `npm test` for behavior tests, `npm run format` to format, and `npm run check` for formatting, tests, types and the plugin build.
