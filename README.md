# WebDAV Sync for Yandex Disk

Manually sync notes and attachments between your Obsidian vault and a dedicated Yandex Disk folder. Works on desktop and mobile, with an English or Russian interface.

## Install and connect

1. Open **Settings → Community plugins** in Obsidian and enable community plugins if needed.
2. Select **Browse**, search for **WebDAV Sync for Yandex Disk**, then install and enable it.
3. Open the plugin settings. Enter your Yandex login, a **Files WebDAV app password**, and a dedicated Disk folder, such as `Obsidian/Personal`. Use the same folder on every device.
4. Select **Test connection**. The result appears in a notification and in settings. The check does not transfer notes or create folders; it stops after 30 seconds if it cannot finish.

You can also install manually: download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/grachevelloper/yandex-obsidian-webdav-sync/releases/latest), put them in `<vault>/.obsidian/plugins/webdav-sync-for-yandex-disk/`, then reload Obsidian and enable the plugin.

## Sync your vault

Select **Preview sync** in the plugin settings, use the ribbon icon, or run **Preview sync with Yandex Disk** from the command palette. Choose a mode:

- **Two-way sync** exchanges changes between this device and Disk. Ordinary deletions are not automatically copied to the other side.
- **Device → Disk** makes Disk match this device, including deleting Disk-only files after confirmation.
- **Disk → device** makes this device match Disk, including deleting device-only files after confirmation.

Review the file list before confirming. Open a file to compare versions, edit the result, choose a version, skip it, or explicitly delete it from both sides. A confirmed manual edit is saved on both sides, including in mirror modes. Nothing is transferred or deleted until you confirm the preview.

**The first sync takes longer.** The plugin reads cloud files to compare their contents and builds a local cache. Later previews can reuse cached comparisons when Disk reports that a file has not changed. Each device builds its own cache. Large attachments, many folders, or a slow connection make the initial check longer.

Sync is manual: run it on one device, then on the other to pick up changes. You can hide and reopen the progress window. Before replacing or deleting files, the plugin checks for newer changes and saves originals locally for recovery.

## Speed and connection issues

**Concurrent requests** allows 1–16 requests to run at once. **Request start interval** separately controls how often a new request starts; the default is one second. Increasing concurrency helps when requests overlap, but does not remove that interval or speed up the sequential folder listing. Higher concurrency uses more memory. Yandex Disk can request a cooldown, which the plugin respects.

If the connection check fails, verify your login, app password, network, and folder access. A missing folder is reported separately from invalid credentials. Use **View latest log** for local sync diagnostics.

## Privacy and recovery

Files travel directly between Obsidian and Yandex Disk over WebDAV. The app password is stored as plain text in the local plugin `data.json`. Plugin configuration is excluded from sync. Diagnostic logs and recovery copies stay on this device; the last 10 sync logs are retained. Keep a separate backup of your vault.
