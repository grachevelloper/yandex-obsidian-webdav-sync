import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebDavStore } from '../../src/webdav/store';
import { WebDavClient, requireStatus } from '../../src/webdav/client';
import { SyncLog } from '../../src/logging/log';
import { response } from './fixtures';

test('network error details never expose credentials', async () => {
  const store = new WebDavStore(
    { login: 'user', password: 'secret', folder: 'Obsidian' },
    async () => {
      throw new Error('secret and Authorization header');
    },
    () => true,
  );
  await assert.rejects(
    store.read('note.md'),
    (error) => error instanceof Error && !error.message.includes('secret'),
  );
});

test('records only method, path and status without response contents or credentials', async () => {
  const log = new SyncLog();
  const http = new WebDavClient(
    { login: 'private-user', password: 'private-password', folder: 'Obsidian' },
    async () => response(503, 'private response body', { Authorization: 'private-header' }),
    log.record,
  );
  const reply = await http.request('GET', 'Obsidian/note.md');
  assert.throws(() => requireStatus(reply, [200]), /503/);
  assert.deepEqual(log.data.events[0]?.details, {
    method: 'GET',
    path: 'Obsidian/note.md',
    status: 503,
  });
  const text = JSON.stringify(log.data);
  for (const secret of [
    'private-user',
    'private-password',
    'private-header',
    'private response body',
  ]) {
    assert.equal(text.includes(secret), false);
  }
});

test('sanitizes network exceptions and records failure context', async () => {
  const log = new SyncLog();
  const http = new WebDavClient(
    { login: 'user', password: 'secret', folder: 'Obsidian' },
    async () => {
      throw new Error('secret Authorization request dump');
    },
    log.record,
  );
  await assert.rejects(http.request('PUT', 'Obsidian/note.md'), /network error/);
  assert.equal(JSON.stringify(log.data).includes('secret'), false);
  assert.equal(log.data.events[0]?.details?.method, 'PUT');
});

test('does not label expected missing files and existing folders as errors', async () => {
  const log = new SyncLog();
  for (const [method, status] of [
    ['GET', 404],
    ['MKCOL', 405],
  ] as const) {
    const http = new WebDavClient(
      { login: 'user', password: 'secret', folder: 'Obsidian' },
      async () => response(status),
      log.record,
    );
    await http.request(method, 'Obsidian/note.md');
  }
  assert.ok(log.data.events.every((event) => event.level === 'info'));
});
