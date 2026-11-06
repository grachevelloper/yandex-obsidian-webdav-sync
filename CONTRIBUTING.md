# Contributing

Use Node.js 24 and a separate task branch and worktree. Install dependencies with
`npm ci`, then run `npm run check` before submitting changes. This checks formatting,
the official Obsidian lint rules, behavior tests, TypeScript types and the
browser-compatible plugin build. `npm run lint` rejects warnings as well as errors.

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
