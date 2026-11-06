import { rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const cache = 'node_modules/.cache/eslint-plugin-obsidianmd/since-map.json';

// The two official rule versions use incompatible API-history cache formats.
rmSync(cache, { force: true });
try {
  const result = spawnSync(
    process.execPath,
    [
      'node_modules/eslint/bin/eslint.js',
      '--config',
      'eslint.community.config.mjs',
      'src',
      '--max-warnings',
      '0',
    ],
    { stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(cache, { force: true });
}
