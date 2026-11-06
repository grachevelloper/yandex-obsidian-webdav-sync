# Contributing

Use Node.js 24 and a separate task branch and worktree. Install dependencies with
`npm ci`, then run `npm run check` before submitting changes. This checks formatting,
the official Obsidian lint rules, behavior tests, TypeScript types and the
browser-compatible plugin build. `npm run lint` rejects warnings as well as errors.
The minimatch overrides keep the lint dependencies on the patched release for
GHSA-g3hv-75wg-m249; remove them when both upstream dependencies require it.

Follow [AGENTS.md](AGENTS.md). Extend the existing tests for the behavior you change.
Runtime code must work on desktop, Android and iOS without Node.js or Electron APIs.
Preserve conflict versions and recovery copies, and never overwrite a file changed
after it was read. Destructive actions require a confirmed sync preview.

For device and WebDAV verification, use the [manual checklist](docs/manual-testing.md)
with disposable vaults. Do not include credentials, private notes, local `data.json`
or unredacted diagnostic logs in an issue or pull request.
