# Real-device verification

TODO(next verification PR): remove this temporary status after completing this checklist with Yandex Disk and the target desktop/mobile devices. Automated tests cover simulated WebDAV, Vault, logging and report rendering; real-device verification is still pending. Never paste an app password into an issue or PR.

Use a dedicated Disk folder and two test vaults. The user connects using their own app password.

- Confirm that a Files WebDAV app password works. An incorrect password must produce an error rather than an empty cloud listing.
- Create a note and PNG/PDF on the phone, sync the phone and then the computer. Compare all bytes, including attachments.
- Edit a note on the computer, sync the computer and then the phone. Repeat in reverse.
- Edit the same note on both devices before syncing. Resolve the conflict in the editor. The approved result must match on both devices and Disk; both originals must remain in local recovery.
- Repeat a conflict with an attachment and during the first connection of two non-empty vaults. Choose either version for the attachment and edit the note result. Confirm that only approved bytes replace the original paths.
- Delete a local note and confirm it is restored from Disk. Delete a disposable test note on Disk and confirm the local version is uploaded again.
- Check nested folders, Cyrillic, spaces, `#`, `%` and `&` in names. Case and Unicode aliases must stop sync before transfers.
- Disconnect during sync, reconnect and rerun. No version should disappear.
- Edit a note while it is being downloaded. The edit must survive or the write must be rejected. Check recovery copies.
- On an isolated disposable file, verify that PUT with an incorrect `If-Match` and PUT of an existing file with `If-None-Match: *` return 412 without changing content. If the server ignores these conditions, do not use overwrites until another protection mechanism is implemented.
- Confirm that unchanged reruns do not transfer files or create conflicts.
- Check the skipped-file report for a file over 50 MiB and the recovery copy after a local overwrite.
- Trigger an authentication error, an HTTP failure and invalid XML. Reopen Obsidian and inspect **Open latest sync log**. Confirm that the failure, request method/path/status and run outcome remain available, without credentials or file contents.
- Verify that only the last 10 run logs are retained and that the report is usable on mobile and with both Obsidian themes.
- Confirm that configuration, credentials, baseline, recovery and logs never appear on Disk. Repeat with a custom configuration directory.
- Install and run from the button and command on the actual phone. Closing the app must not imply background synchronization.

## Preview and confirmation

- Prepare uploads, downloads and a conflict. Run sync and confirm that both device and Disk contents remain unchanged until **Confirm sync**. The preview must show the direction and block confirmation until conflicts are resolved or skipped.
- Cancel with the button, close icon and Escape (desktop). No files, remote folders or sync baseline should change; local diagnostic logs may be written.
- Preview a folder that does not yet exist on Disk. Cancel and confirm it remains absent. Confirm a second preview and check that uploads create the folder only after confirmation.
- Edit the upload source, download destination or cloud version while the preview is open. Confirmation must not overwrite these new edits; the report must request a new preview.
- Add another file after preview. It must wait until the next run.
- Make one file inaccessible during preview. Confirmation must be disabled and the error visible.
- Repeat unchanged files, a missing file, an oversized attachment and empty vaults. No deletion action should appear in Two-way sync.
- Verify the preview in light/dark themes and on the actual phone; long file names and conflict paths must remain readable.

## Request limits

- Open settings from an existing installation without the new fields. Confirm the defaults are 2 concurrent requests and a 1-second interval. Change each independently, restart Obsidian and confirm persistence.
- Try 1 request, then 2, against a disposable test vault with slow files. Verify overlap only in the second case; check request-start times in local diagnostics against the chosen interval.
- Confirm both settings are disabled during preview and confirmed transfers. Invalid intervals must not replace the last valid value.
- Preview and confirm simultaneous downloads into a new shared folder, uploads into a new cloud folder and an edited conflict resolution. No duplicate-folder errors or extra conflict copies should appear.
- Trigger HTTP 429 and verify the shared cooldown delays all new requests, including retries. A terminal failure must not leave file workers running after the final report.

## Progress window

- Start preview and confirm that the progress window appears immediately, before folder discovery finishes. No sync-progress toast should appear in the corner.
- Check two concurrent files, unchanged files, an oversized file and a failed file. The counter counts processed paths once; active paths disappear only when their work finishes.
- Hide the progress window, run the sync command or press the ribbon button again, and confirm the same run reopens with its current counters. Settings should offer **View progress** while the run is active.
- Confirm that the preview appears in the same window. Confirming continues into transfer progress without closing it; closing the preview or disabling the plugin cancels confirmation without transfers.
- Trigger HTTP 429 or a read retry. The window must show the wait reason and countdown, and resume when requests start again.
- Confirm that completion replaces progress with the final report. If the window was hidden, completion should not unexpectedly reopen it; use **View sync progress or last report** to reopen the result.
- Reopen and hide the window repeatedly on desktop and iOS. Confirm timers and counters remain correct, including after an empty run or interrupted sync.

## ETag cache

- Run a preview twice without changes, including once after restarting Obsidian. The first preview reads cloud bytes; the second should log cached-version reuse without GETs for unchanged cached files. Local hashes are still computed.
- Change cloud content without changing its byte count. A new ETag must trigger a fresh read and the correct download/conflict plan. Change local content while leaving cloud ETag unchanged; the local edit must still appear in preview.
- Change an upload destination after a cached preview and before confirmation. Confirmation must re-read it and preserve the newer edit rather than overwrite it.
- Test missing/unsupported tags and a PUT response with no ETag. These must trigger full-read fallback, not an invented cache version.
- Switch the account or remote folder; cached versions must not cross connections. Remove the `remoteCache` field or corrupt one entry in a disposable test vault; settings and synchronized baseline must remain readable.
- Cancel a preview. Verified cache metadata may persist locally, while file contents and `state.hashes` remain unchanged. Inspect that `data.json` and its cache are never sent to Disk.

## Rook sync button

- Reload version 0.1.5 on desktop. Confirm the rook replaces the previous refresh icon in the left ribbon, opens preview and reopens an active run without starting another one.
- Reload on iOS and open the bottom-right ribbon menu. Confirm **Preview sync with Yandex Disk** has the rook icon and starts preview. In ribbon settings, enable the action if it was previously hidden and optionally select it for quick access.
- Add **Preview sync with Yandex Disk** to the mobile editor toolbar. Confirm the rook icon appears and the command works with an open note. Existing toolbar order and quick-access selection must remain unchanged after plugin installation.
- Check the rook at normal toolbar size in light and dark themes.

## Connection check and stop

- Use **Test connection** with valid credentials and an existing folder. It must return success without opening sync progress, changing the baseline/cache, scanning children or writing files. Repeat with a missing folder: account access succeeds with a separate missing-folder message and no folder is created.
- Use an invalid app password, inaccessible folder and unavailable network. The settings must show the error and re-enable the button; no sync should start.
- On desktop and iOS, stop during folder discovery, file checks, a retry countdown and confirmed transfers. No new HTTP request may start after stopping. An already-sent request may finish; the window must say **Stopping…** while waiting.
- Stop with two workers while one write completes and another read is cancelled. The completed file must retain its baseline and appear in stopped-run totals. Restart and run a new preview; no completed file should be lost.
- Stop after a conflict cloud write and before the local write. Completed transfers must be reported, original versions must remain in recovery, and the baseline must not advance prematurely. Rerun preview and verify that both edits remain.
- Hide and reopen progress before stopping. The Stop button and stopping state must remain available. Hiding alone must continue processing; cancelling the confirmation must transfer nothing.

## Mode menu and conflict editor (0.1.7)

- Press the rook on desktop and iOS. The first screen must offer three mode choices without starting requests. Closing the menu does nothing. Repeated activation must not create another menu or run.
- Choose Two-way sync. Check local-only and cloud-only notes: both must be restored without deletion. A conflict must disable final confirmation until resolved or skipped.
- In the text editor, use each source, Use both and a manual edit. Both differing values must survive Use both; common lines appear once. Repeat Use both and check that no duplicates accumulate. A manual draft requires confirmation before replacement. Changing mobile tabs or navigating between files must preserve drafts and resolved state.
- Edit a resolved file again: the resolved count must decrease and confirmation must be blocked until it is resolved again. Skip one conflict: neither original nor its baseline may change.
- Resolve PNG/PDF and invalid-UTF-8 text by choosing a version. Confirm byte-for-byte equality and absence of a text editor. A text file over 1 MiB must use version selection.
- Finish editor review and inspect the main preview, then confirm. Both original paths must contain the result, without newly generated conflict-copy files. Original hashes must exist under local recovery.
- Modify either version while the editor or preview is open. Confirmation must reject the changed file. Disconnect after cloud success but before local success: the report must show the completed upload and recovery must contain both originals.
- In a disposable folder, run Device → Disk with local-only, cloud-only, changed and identical files. Confirm the listed remote deletions and verify that source bytes are unchanged and destination files match.
- Repeat Disk → device in reverse. Confirm local deletions go to Obsidian trash and recovery. Hidden/configuration paths must never enter either plan. Empty directories may remain.
- Try a missing source folder, failed discovery, oversized file and recovery-write failure. These must not become an empty-source mirror or an unprotected overwrite/deletion.
- Change a deletion target or add the source file after preview. Its deletion must be rejected. Verify stale cloud If-Match rejection with no unconditional retry.

## Per-file review and menu layout

- Check the start menu with the installed Obsidian theme at desktop and 390px/320px widths. All labels and descriptions must share a left edge and fit inside compact buttons; the title and footnote must use the intended compact sizes.
- Open incoming-only, outgoing-only, existing changed and unchanged files from the preview. Downloads must initialize Result from Disk and uploads from the device. Missing versions must be labelled as absent and cannot be selected.
- Edit an incoming note, Apply to preview, then confirm: the approved text must reach both sides and both available originals must remain recoverable. Back to preview must not stage a draft. Choosing the local version of a proposed download must send that version to Disk instead.
- Skip one incoming file, all remaining downloads and all remaining uploads. No skipped path may be transferred or deleted; previously reviewed choices must not be silently changed. A subsequent run may propose the skipped files again.
- Inspect images and PDFs from each side on desktop and iOS. Images must render inline; PDF embedding depends on the platform viewer and Open attachment must remain available. Closing or changing the view must release local object URLs.
- In each mirror mode, edit a file scheduled for transfer or deletion and apply it to the preview. Check the source-change warning and the updated deletion count. Confirm and verify the reviewed result on both sides. Skip another path and check that it stays unchanged.
- Switch between Russian, English and Follow Obsidian. Check settings, mode menu, preview, editor, progress, reports and a failed connection. Verify that the preference persists and that file names, HTTP codes and older logs are preserved.
