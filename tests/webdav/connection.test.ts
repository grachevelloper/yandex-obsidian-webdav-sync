import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { build } from 'esbuild';
import { checkConnection } from '../../src/webdav/connection';
import type { HttpRequest } from '../../src/webdav/client';
import { listing, response } from './fixtures';
import { clock } from './timing';

const connection = { login: 'user', password: 'secret', folder: 'Obsidian/Personal' };

test('connection check reads only root and selected folder properties without listing children', async () => {
  const requests: HttpRequest[] = [];
  const result = await checkConnection(
    connection,
    async (request) => {
      requests.push(request);
      return response(207, listing(new URL(request.url).pathname, '<d:collection/>'));
    },
    { timing: clock() },
  );
  assert.equal(result.folderExists, true);
  assert.equal(requests.length, 2);
  assert.ok(
    requests.every((request) => request.method === 'PROPFIND' && request.headers.Depth === '0'),
  );
});

test('valid credentials with a missing folder are distinguished from authentication failure', async () => {
  const result = await checkConnection(
    connection,
    async (request) =>
      new URL(request.url).pathname === '/'
        ? response(207, listing('/', '<d:collection/>'))
        : response(404),
    { timing: clock() },
  );
  assert.equal(result.folderExists, false);
  for (const status of [401, 403]) {
    await assert.rejects(
      checkConnection(connection, async () => response(status), { timing: clock() }),
      /login|password|access/i,
    );
  }
});

test('connection check rejects malformed properties and a file in place of the folder', async () => {
  for (const body of ['not XML', listing('/', '')]) {
    await assert.rejects(
      checkConnection(connection, async () => response(207, body), { timing: clock() }),
    );
  }
});

test('connection check times out a stalled request without starting another request', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  let finishRequest = (_value: ReturnType<typeof response>) => {};
  const stalled = new Promise<ReturnType<typeof response>>((resolve) => {
    finishRequest = resolve;
  });
  const pending = checkConnection(connection, () => {
    calls++;
    return stalled;
  });
  const rejected = assert.rejects(pending, /timed out/i);
  await new Promise<void>((resolve) => setImmediate(resolve));
  context.mock.timers.tick(30_000);
  await rejected;
  finishRequest(response(207, listing('/', '<d:collection/>')));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
});

test('plugin records the localized connection outcome and releases the busy state', async (context) => {
  const bundle = await build({
    stdin: {
      contents: `export { default as WebDavSync } from './src/main';
        export { http } from './tests/helpers/obsidian-host.mjs';
        export { setLanguage, t } from './src/i18n';`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    alias: { obsidian: path.resolve('tests/helpers/obsidian-host.mjs') },
  });
  const output = bundle.outputFiles[0];
  assert.ok(output);
  const { WebDavSync, http, setLanguage, t } = await import(
    `data:text/javascript;base64,${Buffer.from(output.contents).toString('base64')}`
  );
  const plugin = new WebDavSync(
    { vault: { configDir: '.obsidian', adapter: {} } },
    { id: 'test', name: 'Test' },
  );
  await plugin.onload();
  Object.assign(plugin.data.settings, connection, { requestIntervalMs: 100 });
  const scenarios = [
    {
      status: 207,
      language: 'en',
      kind: 'success',
      expected: 'Login, app password and folder access are valid. No files were changed.',
    },
    {
      status: 207,
      language: 'ru',
      kind: 'success',
      expected: 'Login, app password and folder access are valid. No files were changed.',
    },
    {
      status: 404,
      language: 'en',
      kind: 'warning',
      expected: 'Login and app password are valid. Check the folder path in settings.',
    },
    {
      status: 401,
      language: 'en',
      kind: 'error',
      expected: 'Check your login, app password and WebDAV access.',
    },
  ];
  for (const scenario of scenarios) {
    setLanguage(scenario.language);
    http.send = async (request: { url: string }) => {
      const pathname = new URL(request.url).pathname;
      return response(
        pathname === '/' && scenario.status === 404 ? 207 : scenario.status,
        listing(pathname, '<d:collection/>'),
      );
    };
    const pending = plugin.testConnection();
    assert.equal(plugin.checkingConnection, true);
    await plugin.testConnection();
    await pending;
    assert.equal(plugin.checkingConnection, false);
    assert.equal(plugin.connectionResult?.kind, scenario.kind);
    assert.ok(plugin.connectionResult?.message.includes(t(scenario.expected)));
  }
  context.mock.timers.enable({ apis: ['setTimeout'] });
  http.send = () => new Promise(() => {});
  const pending = plugin.testConnection();
  await new Promise<void>((resolve) => setImmediate(resolve));
  context.mock.timers.tick(30_000);
  await pending;
  assert.equal(plugin.checkingConnection, false);
  assert.equal(plugin.connectionResult?.kind, 'error');
  assert.match(plugin.connectionResult?.message ?? '', /timed out/i);
  plugin.onunload();
});
