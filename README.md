# WebDAV Sync for Yandex Disk

Manually sync Obsidian notes and attachments with Yandex Disk on desktop and mobile. Available in English and Russian.

## Sync modes

- **Two-way:** exchange changes between this device and Disk without automatically propagating deletions.
- **Device → Disk:** make Disk match this device.
- **Disk → device:** make this device match Disk.

Preview changes before confirming. Compare versions, edit notes, resolve conflicts, or skip files. Mirror modes can delete destination-only files; explicit deletion removes a file from both sides. Confirmed manual edits are saved on both sides.

Two-way sync combines independent edits to supported text files and asks which version to use for overlapping changes. It keeps the last shared text on this device for that comparison. If the shared text is unavailable, review both versions manually.

The preview can pair a move when the old and new paths have the same content and there is a single match. Click the name in a file's review to rename it. Moves and renames take effect after confirmation. Previous versions from a merge or manual replacement can be restored as separate local files from the report.

## Connect and sync

Enter your Yandex login, a **Files WebDAV app password**, and a dedicated Disk folder in the plugin settings. Use the same folder on every device. Select **Test connection**, then **Preview sync**.

**The first sync takes longer:** the plugin reads cloud files to compare them. Later checks reuse cached comparisons for unchanged files. Each device builds its own cache.

Sync runs only when you start it. Files go directly to Yandex Disk. The app password is stored locally as plain text. Recovery copies and diagnostic logs stay on your device. Keep a separate backup of your vault.
