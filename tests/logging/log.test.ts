import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SyncLog } from '../../src/logging/log';
import { LogRepository } from '../../src/logging/repository';

function storage() {
  const files = new Map<string, string>();
  const folders = new Set<string>();
  const adapter = {
    exists: async (path: string) => folders.has(path) || files.has(path),
    mkdir: async (path: string) => {
      folders.add(path);
    },
    write: async (path: string, value: string) => {
      files.set(path, value);
    },
    read: async (path: string) => {
      const value = files.get(path);
      if (value === undefined) throw new Error('Missing');
      return value;
    },
    list: async (path: string) => ({
      files: [...files.keys()].filter((file) => file.startsWith(`${path}/`)),
      folders: [],
    }),
    remove: async (path: string) => {
      files.delete(path);
    },
  };
  return {
    files,
    repository: new LogRepository(adapter, '.obsidian/plugins/yandex-disk-sync/logs'),
  };
}

test('persists failed runs and loads their diagnostics after restart', async () => {
  const { repository } = storage();
  const log = new SyncLog();
  log.record('error', 'WebDAV GET failed', { path: 'notes/a.md', status: 503 });
  log.fail('Connection unavailable');
  await repository.save(log.data);
  const restored = await repository.latest();
  assert.equal(restored?.outcome, 'failed');
  assert.equal(restored?.failure, 'Connection unavailable');
  assert.equal(restored?.events[0]?.details?.status, 503);
});

test('retains only the latest ten run logs and rejects corrupted saved data', async () => {
  const { repository, files } = storage();
  for (let index = 0; index < 12; index++) {
    const log = new SyncLog();
    log.fail(`Run ${index}`);
    await repository.save(log.data);
  }
  assert.equal([...files.keys()].filter((path) => !path.endsWith('/latest.json')).length, 10);
  assert.equal((await repository.latest())?.failure, 'Run 11');
  files.set('.obsidian/plugins/yandex-disk-sync/logs/latest.json', '{"password":"private"}');
  await assert.rejects(repository.latest(), /Invalid sync log/);
});

test('bounds in-memory diagnostic events', () => {
  const log = new SyncLog();
  for (let index = 0; index < 2100; index++) log.record('info', 'Reading file');
  assert.equal(log.data.events.length, 2000);
  assert.equal(log.data.droppedEvents, 100);
});

test('rejects malformed metadata, events and sync results when loading logs', async () => {
  const { repository, files } = storage();
  const valid = new SyncLog().data;
  const invalidLogs = [
    { ...valid, outcome: ['completed'] },
    { ...valid, events: [{ time: valid.startedAt, level: ['info'], message: 'test' }] },
    { ...valid, events: [null] },
    {
      ...valid,
      events: [{ time: valid.startedAt, level: 'info', message: 'test', details: { status: [] } }],
    },
    { ...valid, finishedAt: 1 },
    { ...valid, failure: {} },
    {
      ...valid,
      result: {
        uploaded: 0,
        downloaded: 0,
        conflicts: [{ path: 'note.md' }],
        skipped: [],
        errors: [],
      },
    },
    {
      ...valid,
      result: { uploaded: 0, downloaded: 0, conflicts: [], skipped: [false], errors: [] },
    },
  ];

  for (const value of invalidLogs) {
    files.set('.obsidian/plugins/yandex-disk-sync/logs/latest.json', JSON.stringify(value));
    await assert.rejects(repository.latest(), /Invalid sync log/);
  }
});

test('restores completed logs including conflict paths and optional metadata', async () => {
  const { repository } = storage();
  const log = new SyncLog();
  log.record('info', 'Preserved conflict', { path: 'note.md', status: 201 });
  log.complete({
    uploaded: 1,
    downloaded: 1,
    conflicts: [{ path: 'note.md', copyPath: 'copy.md' }],
    skipped: [],
    errors: [],
  });
  await repository.save(log.data);

  assert.deepEqual(await repository.latest(), log.data);
});

test('persists cancellation separately from success and failure', async () => {
  const { repository } = storage();
  const log = new SyncLog();
  log.cancel();
  await repository.save(log.data);
  const restored = await repository.latest();
  assert.equal(restored?.outcome, 'cancelled');
  assert.ok(restored?.finishedAt);
  assert.equal(restored?.result, undefined);
});
