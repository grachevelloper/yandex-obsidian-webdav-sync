# Development

- This is a personal-use TypeScript Obsidian plugin. Keep runtime code compatible with desktop, Android, and iOS. Do not use Node.js or Electron in plugin code.
- Separate sync logic, WebDAV transport, vault access, settings, and UI into focused folders. Prefer KISS and DRY; avoid speculative abstractions and unnecessary domain layers.
- Use TDD for sync decisions, conflict preservation, path handling, and transport failures: write a failing behavior test, implement the smallest change, then refactor.
- Separate logical code blocks with blank lines. Comment only non-obvious exceptions and explain why they are necessary.
- Two-way sync never propagates deletions automatically. Explicit deletion from the editor requires preview confirmation. Mirror modes may delete destination-only files only after an explicit preview confirmation. Preserve original bytes in local recovery before destructive actions. Never overwrite a file whose contents changed after it was read.
- Run the relevant tests, type check, build, and review the complete diff before submitting a PR. Do not merge without the user's approval.
- Use the configured Git identity. Never add assistant co-author trailers. Push only when the user requests publishing changes or creating a PR for the current task.
