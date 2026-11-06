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
    store.write('note.md', new ArrayBuffer(0), undefined),
    (error) => error instanceof Error && !error.message.includes('secret'),
  );
});

test('records request metadata and duration without response contents or credentials', async () => {
  const log = new SyncLog();
  const http = new WebDavClient(
    { login: 'private-user', password: 'private-password', folder: 'Obsidian' },
    async () => response(503, 'private response body', { Authorization: 'private-header' }),
    log.record,
  );
  const reply = await http.request('GET', 'Obsidian/note.md');
  assert.throws(() => requireStatus(reply, [200]), /503/);
  const { elapsedMs, ...requestDetails } =
    log.data.events.find((event) => event.message === 'WebDAV response')?.details ?? {};
  assert.ok(typeof elapsedMs === 'number' && elapsedMs >= 0);
  assert.deepEqual(requestDetails, {
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

test('retains the clock context when recording request durations', async () => {
  const log = new SyncLog();
  const timing = {
    milliseconds: 100,
    now() {
      return this.milliseconds;
    },
    async sleep(milliseconds: number) {
      this.milliseconds += milliseconds;
    },
  };
  const client = new WebDavClient(
    { login: 'user', password: 'secret', folder: 'Obsidian' },
    async () => {
      timing.milliseconds += 25;
      return response(200);
    },
    log.record,
    { timing },
  );
  await client.request('GET', 'Obsidian/note.md');
  assert.equal(
    log.data.events.find((event) => event.message === 'WebDAV response')?.details?.elapsedMs,
    25,
  );
});
