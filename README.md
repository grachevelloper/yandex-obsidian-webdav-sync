# WebDAV Sync for Yandex Disk

Manually sync Obsidian notes and attachments with Yandex Disk on desktop and mobile. Available in English and Russian.

## Sync modes

- **Two-way:** exchange changes between this device and Disk without automatically propagating deletions.
- **Device → Disk:** make Disk match this device.
- **Disk → device:** make this device match Disk.

Preview changes before confirming. Compare versions, edit notes, resolve conflicts, or skip files. Mirror modes can delete destination-only files; explicit deletion removes a file from both sides. Confirmed manual edits are saved on both sides.

## Connect and sync

Enter your Yandex login, a **Files WebDAV app password**, and a dedicated Disk folder in the plugin settings. Use the same folder on every device. Select **Test connection**, then **Preview sync**.

**The first sync takes longer:** the plugin reads cloud files to compare them. Later checks reuse cached comparisons for unchanged files. Each device builds its own cache.

Sync runs only when you start it. Files go directly to Yandex Disk. The app password is stored locally as plain text. Recovery copies and diagnostic logs stay on your device. Keep a separate backup of your vault.
