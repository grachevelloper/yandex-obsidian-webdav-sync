# Real-device verification

TODO(next verification PR): remove this temporary status after completing this checklist with Yandex Disk and the target desktop/mobile devices. Automated tests cover simulated WebDAV, Vault, logging and report rendering; real-device verification is still pending. Never paste an app password into an issue or PR.

Use a dedicated Disk folder and two test vaults. The user connects using their own app password.

- Confirm that a Files WebDAV app password works. An incorrect password must produce an error rather than an empty cloud listing.
- Create a note and PNG/PDF on the phone, sync the phone and then the computer. Compare all bytes, including attachments.
- Edit a note on the computer, sync the computer and then the phone. Repeat in reverse.
- Edit the same note on both devices before syncing. Both versions must remain on both devices and Disk. A later unchanged run must not create more copies.
- Repeat a conflict with an attachment and during the first connection of two non-empty vaults. Check that the report identifies the cloud original and the local conflict copy with their exact paths.
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

- Prepare uploads, downloads and a conflict. Run sync and confirm that both device and Disk contents remain unchanged until **Confirm sync**. The preview must show the direction and exact conflict-copy path.
- Cancel with the button, close icon and Escape (desktop). No files, remote folders or sync baseline should change; local diagnostic logs may be written.
- Preview a folder that does not yet exist on Disk. Cancel and confirm it remains absent. Confirm a second preview and check that uploads create the folder only after confirmation.
- Edit the upload source, download destination or cloud version while the preview is open. Confirmation must not overwrite these new edits; the report must request a new preview.
- Add another file after preview. It must wait until the next run.
- Make one file inaccessible during preview. Confirmation must be disabled and the error visible.
- Repeat unchanged files, a missing file, an oversized attachment and empty vaults. No deletion action should appear.
- Verify the preview in light/dark themes and on the actual phone; long file names and conflict paths must remain readable.

## Request limits

- Open settings from an existing installation without the new fields. Confirm the defaults are 2 concurrent requests and a 1-second interval. Change each independently, restart Obsidian and confirm persistence.
- Try 1 request, then 2, against a disposable test vault with slow files. Verify overlap only in the second case; check request-start times in local diagnostics against the chosen interval.
- Confirm both settings are disabled during preview and confirmed transfers. Invalid intervals must not replace the last valid value.
- Preview and confirm simultaneous downloads into a new shared folder, uploads into a new cloud folder and a conflict beside a copy from an interrupted run. No duplicate-folder errors or extra conflict copies should appear.
- Trigger HTTP 429 and verify the shared cooldown delays all new requests, including retries. A terminal failure must not leave file workers running after the final report.

## Progress window

- Start preview and confirm that the progress window appears immediately, before folder discovery finishes. No sync-progress toast should appear in the corner.
- Check two concurrent files, unchanged files, an oversized file and a failed file. The counter counts processed paths once; active paths disappear only when their work finishes.
- Hide the progress window, run the sync command or press the ribbon button again, and confirm the same run reopens with its current counters. Settings should offer **View progress** while the run is active.
- Confirm that the preview appears in the same window. Confirming continues into transfer progress without closing it; closing the preview or disabling the plugin cancels confirmation without transfers.
- Trigger HTTP 429 or a read retry. The window must show the wait reason and countdown, and resume when requests start again.
- Confirm that completion replaces progress with the final report. If the window was hidden, completion should not unexpectedly reopen it; use **View sync progress or last report** to reopen the result.
- Reopen and hide the window repeatedly on desktop and iOS. Confirm timers and counters remain correct, including after an empty run or interrupted sync.
