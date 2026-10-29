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
