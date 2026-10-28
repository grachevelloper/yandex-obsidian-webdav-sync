import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  snapshot,
  synchronize,
  type Snapshot,
  type SyncState,
  type SyncStore,
} from '../src/sync/engine';

class MemoryStore implements SyncStore {
  files = new Map<string, Snapshot>();
  failWrites = false;

  async set(path: string, content: string | number[]) {
    const bytes =
      typeof content === 'string' ? new TextEncoder().encode(content) : new Uint8Array(content);
    this.files.set(path, await snapshot(bytes.buffer));
  }

  async list() {
    return [...this.files].map(([path, value]) => ({ path, size: value.data.byteLength }));
  }

  async read(path: string) {
    return this.files.get(path);
  }

  async write(path: string, data: ArrayBuffer, expected: Snapshot | undefined) {
    if (this.failWrites) throw new Error('Network unavailable');
    assert.equal(this.files.get(path)?.hash, expected?.hash, 'stale writes must be rejected');
    this.files.set(path, await snapshot(data));
  }
}

function setup() {
  const local = new MemoryStore();
  const remote = new MemoryStore();
  const state: SyncState = { version: 1, scope: 'test', hashes: {} };
  let checkpoints = 0;
  const run = () =>
    synchronize(local, remote, state, async () => {
      checkpoints++;
    });

  return { local, remote, state, run, checkpoints: () => checkpoints };
}

test('exchanges new notes and binary attachments in both directions', async () => {
  const { local, remote, run } = setup();
  await local.set('folder/phone.md', 'phone');
  await remote.set('images/photo.png', [0, 255, 128, 1]);

  const result = await run();

  assert.equal(result.uploaded, 1);
  assert.equal(result.downloaded, 1);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(local.files, remote.files);
});

test('uses last synchronized content to identify the changed side', async () => {
  const { local, remote, run } = setup();
  await local.set('note.md', 'initial');
  await run();
  await local.set('note.md', 'local edit');
  assert.equal((await run()).uploaded, 1);
  await remote.set('note.md', 'remote edit');
  assert.equal((await run()).downloaded, 1);
  assert.deepEqual(local.files, remote.files);
});

test('preserves both versions on both devices, including on first sync', async () => {
  for (const initialSync of [true, false]) {
    const { local, remote, run } = setup();
    if (!initialSync) {
      await local.set('note.md', 'initial');
      await run();
    }

    await local.set('note.md', 'local edit');
    await remote.set('note.md', 'remote edit');
    const result = await run();

    assert.deepEqual(result.conflicts, ['note.md']);
    assert.deepEqual(local.files, remote.files);
    assert.equal(local.files.size, 2);
    const contents = [...local.files.values()].map((value) => new TextDecoder().decode(value.data));
    assert.deepEqual(contents.sort(), ['local edit', 'remote edit']);
    assert.equal((await run()).conflicts.length, 0);
    assert.equal(local.files.size, 2);
  }
});

test('restores missing files without propagating deletions', async () => {
  const { local, remote, run } = setup();
  await local.set('note.md', 'initial');
  await run();
  local.files.delete('note.md');
  assert.equal((await run()).downloaded, 1);
  remote.files.delete('note.md');
  assert.equal((await run()).uploaded, 1);
});

test('does not replace the original if conflict upload fails; retry converges', async () => {
  const { local, remote, state, run } = setup();
  await local.set('note.md', 'local');
  await remote.set('note.md', 'remote');
  const original = local.files.get('note.md');
  remote.failWrites = true;

  assert.equal((await run()).errors.length, 1);
  assert.equal(local.files.get('note.md'), original);
  assert.equal(Object.keys(state.hashes).length, 0);

  remote.failWrites = false;
  await run();
  assert.deepEqual(local.files, remote.files);
  assert.equal(local.files.size, 2);
});

test('stops when checkpoint persistence fails', async () => {
  const { local, remote, state } = setup();
  await local.set('a.md', 'a');
  await local.set('b.md', 'b');

  await assert.rejects(
    synchronize(local, remote, state, async () => {
      throw new Error('Disk full');
    }),
    /Disk full/,
  );
  assert.equal(remote.files.size, 1);
});

test('leaves synchronized files untouched on repeat runs', async () => {
  const { local, remote, run } = setup();
  await local.set('note.md', 'same');
  await run();
  local.failWrites = true;
  remote.failWrites = true;
  assert.deepEqual(await run(), {
    uploaded: 0,
    downloaded: 0,
    conflicts: [],
    skipped: [],
    errors: [],
  });
});

test('rejects file-folder collisions before transferring any files', async () => {
  const { local, remote, run } = setup();
  await local.set('folder', 'file');
  await remote.set('folder/note.md', 'note');
  await assert.rejects(run(), /[Пп]ут/);
  assert.equal(local.files.size, 1);
  assert.equal(remote.files.size, 1);
});

test('rejects case and Unicode aliases before writing on case-insensitive devices', async () => {
  for (const [first, second] of [
    ['Notes/a.md', 'notes/b.md'],
    ['café.md', 'cafe\u0301.md'],
  ]) {
    const { local, remote, run } = setup();
    assert.ok(first && second);
    await local.set(first, 'local');
    await remote.set(second, 'remote');
    await assert.rejects(run(), /[Пп]ут/);
    assert.equal(local.files.size, 1);
    assert.equal(remote.files.size, 1);
  }
});

test('does not mark a rejected remote overwrite as synchronized', async () => {
  const { local, remote, state, run } = setup();
  await local.set('note.md', 'original');
  await run();
  const baseline = state.hashes['note.md'];
  await local.set('note.md', 'edited');
  remote.failWrites = true;
  assert.equal((await run()).errors.length, 1);
  assert.equal(state.hashes['note.md'], baseline);
});
