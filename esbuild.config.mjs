import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian'],
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  outfile: 'main.js',
  sourcemap: false,
});

await mkdir('release/yandex-disk-sync', { recursive: true });
await Promise.all(
  ['main.js', 'manifest.json'].map((file) => copyFile(file, `release/yandex-disk-sync/${file}`)),
);
