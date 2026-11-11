import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function writeGallery(directory, manifest) {
  const template = await readFile(new URL('./gallery.html', import.meta.url), 'utf8');
  const data = JSON.stringify(manifest).replaceAll('<', '\\u003c');
  const html = template.replace('<!-- gallery-manifest -->', () => data);
  await writeFile(join(directory, 'index.html'), html);
}
