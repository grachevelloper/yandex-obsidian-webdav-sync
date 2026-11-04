import { build } from 'esbuild';
import { copyFile, mkdir, readFile } from 'node:fs/promises';

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

const { id } = JSON.parse(await readFile('manifest.json', 'utf8'));
const releaseFolder = `release/${id}`;
await mkdir(releaseFolder, { recursive: true });
await Promise.all(
  ['main.js', 'manifest.json', 'styles.css'].map((file) =>
    copyFile(file, `${releaseFolder}/${file}`),
  ),
);
