import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve('.artifacts/ui-gallery');
const port = Number(process.env.UI_PORT ?? 4783);
const types = {
  html: 'text/html; charset=utf-8',
  json: 'application/json; charset=utf-8',
  png: 'image/png',
};

if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('UI_PORT must be an integer from 1024 to 65535');

await readFile(resolve(root, 'manifest.json')).catch(() => {
  throw new Error('Capture the gallery first: npm run ui:capture');
});

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  const path = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  if (
    !['index.html', 'manifest.json'].includes(path) &&
    !/^screenshots\/[a-z0-9-]+\.png$/u.test(path)
  ) {
    response.writeHead(404).end('Not found');
    return;
  }
  try {
    const data = await readFile(resolve(root, path));
    response
      .writeHead(200, {
        'Content-Type': types[path.split('.').at(-1)],
        'Cache-Control': 'no-store',
      })
      .end(data);
  } catch {
    response.writeHead(404).end('Not found');
  }
});
server.listen(port, '127.0.0.1', () =>
  console.log(`Obsidian UI gallery: http://127.0.0.1:${port}`),
);
