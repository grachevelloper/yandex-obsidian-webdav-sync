import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planSync } from '../../src/sync/plan';
import { executePlan } from '../../src/sync/engine';
import { snapshot } from '../../src/sync/snapshot';
import type { Snapshot, SyncState, SyncStore } from '../../src/sync/types';

class MemoryStore implements SyncStore {
  files = new Map<string, Snapshot>();
  writes: string[] = [];

  async set(path: string, text: string) {
    this.files.set(path, await snapshot(new TextEncoder().encode(text).buffer));
  }

  async list() {
    return [...this.files].map(([path, value]) => ({ path, size: value.data.byteLength }));
  }

  async read(path: string) {
    return this.files.get(path);
  }

  async write(path: string, data: ArrayBuffer, expected: Snapshot | undefined) {
    assert.equal(this.files.get(path)?.hash, expected?.hash);
    this.writes.push(path);
    this.files.set(path, await snapshot(data));
  }
}

function setup() {
  const state: SyncState = { version: 1, scope: 'test', hashes: {} };
  return { local: new MemoryStore(), remote: new MemoryStore(), state };
}

test('previews uploads, downloads, conflicts and unchanged files without writing or changing the baseline', async () => {
  const { local, remote, state } = setup();
  await local.set('phone.md', 'phone');
  await remote.set('cloud.md', 'cloud');
  await local.set('both.md', 'local');
  await remote.set('both.md', 'remote');
  await local.set('same.md', 'same');
  await remote.set('same.md', 'same');
  const plan = await planSync(local, remote, state);

  assert.deepEqual(
    plan.entries.map(({ path, action }) => [path, action]),
    [
      ['both.md', 'conflict'],
      ['cloud.md', 'download'],
      ['phone.md', 'upload'],
      ['same.md', 'unchanged'],
    ],
  );
  assert.ok(plan.entries[0]?.copyPath?.includes('.conflict-'));
  assert.equal(local.writes.length + remote.writes.length, 0);
  assert.deepEqual(state.hashes, {});
  assert.doesNotMatch(JSON.stringify(plan), /"data"/);

  const result = await executePlan(local, remote, state, plan, async () => {});
  assert.equal(result.uploaded, 2);
  assert.equal(result.downloaded, 2);
  assert.deepEqual(local.files, remote.files);
});

test('refuses a changed source, a changed destination or a newly appeared file after preview', async () => {
  for (const change of ['source', 'destination', 'appeared']) {
    const { local, remote, state } = setup();
    await local.set('note.md', 'approved');
    if (change !== 'appeared') {
      await remote.set('note.md', 'before');
      const previous = remote.files.get('note.md');
      assert.ok(previous);
      state.hashes['note.md'] = previous.hash;
    }
    const plan = await planSync(local, remote, state);
    if (change === 'source') await local.set('note.md', 'new edit');
    else await remote.set('note.md', 'new cloud edit');

    const result = await executePlan(local, remote, state, plan, async () => {});
    assert.equal(result.uploaded, 0);
    assert.match(result.errors[0] ?? '', /preview/);
    assert.equal(local.writes.length + remote.writes.length, 0);
  }
});

test('restores missing files and never proposes or executes deletions', async () => {
  const { local, remote, state } = setup();
  await local.set('restore-cloud.md', 'local');
  await remote.set('restore-phone.md', 'remote');
  const plan = await planSync(local, remote, state);
  assert.deepEqual(
    plan.entries.map(({ action }) => action),
    ['upload', 'download'],
  );
  await executePlan(local, remote, state, plan, async () => {});
  assert.equal(local.files.size, 2);
  assert.equal(remote.files.size, 2);
});

test('blocks incomplete previews and previews from another connection before any writes', async () => {
  const { local, remote, state } = setup();
  await local.set('a.md', 'a');
  await local.set('b.md', 'b');
  remote.read = async (path) => {
    if (path === 'b.md') throw new Error('Unavailable');
    return undefined;
  };
  const incomplete = await planSync(local, remote, state);
  assert.equal(incomplete.entries.filter(({ action }) => action === 'error').length, 1);
  await assert.rejects(
    executePlan(local, remote, state, incomplete, async () => {}),
    /preview/,
  );
  remote.read = async () => undefined;
  const plan = await planSync(local, remote, state);
  state.scope = 'different';
  await assert.rejects(
    executePlan(local, remote, state, plan, async () => {}),
    /connection/,
  );
  assert.equal(local.writes.length + remote.writes.length, 0);
});

test('execution changes only approved paths, leaving files added after preview for the next run', async () => {
  const { local, remote, state } = setup();
  await local.set('approved.md', 'approved');
  const plan = await planSync(local, remote, state);
  await remote.set('later.md', 'later');
  await executePlan(local, remote, state, plan, async () => {});
  assert.equal(local.files.has('later.md'), false);
  assert.deepEqual(remote.writes, ['approved.md']);
});

test('preserves a local download destination and both sides of a conflict edited after preview', async () => {
  for (const conflict of [false, true]) {
    const { local, remote, state } = setup();
    await local.set('note.md', 'local');
    await remote.set('note.md', 'cloud');
    const original = local.files.get('note.md');
    assert.ok(original);
    if (!conflict) state.hashes['note.md'] = original.hash;
    const plan = await planSync(local, remote, state);
    await local.set('note.md', 'edit while reviewing');
    const result = await executePlan(local, remote, state, plan, async () => {});
    assert.equal(result.errors.length, 1);
    assert.equal(result.downloaded, 0);
    assert.equal(local.writes.length + remote.writes.length, 0);
    assert.equal(
      new TextDecoder().decode(local.files.get('note.md')?.data),
      'edit while reviewing',
    );
  }
});

test('refuses a changed sync baseline before writing any approved path', async () => {
  const { local, remote, state } = setup();
  await local.set('note.md', 'approved');
  const plan = await planSync(local, remote, state);
  state.hashes['note.md'] = 'changed';
  await assert.rejects(
    executePlan(local, remote, state, plan, async () => {}),
    /state changed/,
  );
  assert.equal(remote.writes.length, 0);
});

test('reuses an identical conflict copy left by an interrupted run', async () => {
  const { local, remote, state } = setup();
  await local.set('note.md', 'local');
  await remote.set('note.md', 'cloud');
  const first = await planSync(local, remote, state);
  const copyPath = first.entries[0]?.copyPath;
  assert.ok(copyPath);
  await local.set(copyPath, 'local');
  const plan = await planSync(local, remote, state);
  const result = await executePlan(
    local,
    remote,
    state,
    plan,
    async () => {},
    undefined,
    undefined,
    2,
  );
  assert.deepEqual(result.errors, []);
  assert.deepEqual(local.files, remote.files);
  assert.equal(local.files.size, 2);
});

test('previews two files concurrently while keeping the file list in a stable order', async () => {
  const { local, remote, state } = setup();
  for (const path of ['a.md', 'b.md', 'c.md']) await local.set(path, path);
  let release = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let active = 0;
  let peak = 0;
  const reads: string[] = [];
  remote.read = async (path) => {
    reads.push(path);
    peak = Math.max(peak, ++active);
    if (path === 'a.md') await blocked;
    active--;
    return undefined;
  };
  const pending = planSync(local, remote, state, undefined, undefined, 2);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(peak, 2);
  assert.deepEqual(reads, ['a.md', 'b.md', 'c.md']);
  release();
  const plan = await pending;
  assert.deepEqual(
    plan.entries.map(({ path }) => path),
    ['a.md', 'b.md', 'c.md'],
  );
});

test('uploads independent files concurrently and serializes baseline persistence', async () => {
  const { local, remote, state } = setup();
  for (const path of ['a.md', 'b.md']) await local.set(path, path);
  const plan = await planSync(local, remote, state);
  const write = remote.write.bind(remote);
  let release = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started: string[] = [];
  remote.write = async (path, data, expected) => {
    started.push(path);
    if (path === 'a.md') await blocked;
    await write(path, data, expected);
  };
  let saves = 0;
  let peak = 0;
  const running = executePlan(
    local,
    remote,
    state,
    plan,
    async () => {
      peak = Math.max(peak, ++saves);
      await new Promise<void>((resolve) => setImmediate(resolve));
      saves--;
    },
    undefined,
    undefined,
    2,
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ['a.md', 'b.md']);
  release();
  const result = await running;
  assert.equal(result.uploaded, 2);
  assert.equal(peak, 1);
  assert.deepEqual(local.files, remote.files);
});

test('does not start another write after a fatal persistence failure in a parallel worker', async () => {
  const { local, remote, state } = setup();
  for (const path of ['a.md', 'b.md', 'c.md']) await local.set(path, path);
  const plan = await planSync(local, remote, state);
  let release = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  remote.read = async (path) => {
    if (path === 'b.md') await blocked;
    return undefined;
  };
  let reportFailure = () => {};
  const checkpointStarted = new Promise<void>((resolve) => {
    reportFailure = resolve;
  });
  const running = executePlan(
    local,
    remote,
    state,
    plan,
    async () => {
      reportFailure();
      throw new Error('Disk full');
    },
    undefined,
    undefined,
    2,
  );
  const rejected = assert.rejects(running, /Disk full/);
  await checkpointStarted;
  await new Promise<void>((resolve) => setImmediate(resolve));
  release();
  await rejected;
  assert.deepEqual(remote.writes, ['a.md']);
});

test('preview progress counts skipped and failed files and keeps active paths accurate', async () => {
  const { local, remote, state } = setup();
  await local.set('a.md', 'a');
  await local.set('b.md', 'b');
  const list = local.list.bind(local);
  local.list = async () => [...(await list()), { path: 'large.bin', size: 60 * 1024 * 1024 }];
  remote.read = async (path) => {
    if (path === 'a.md') throw new Error('Unavailable');
    return undefined;
  };
  const updates: import('../../src/sync/progress').SyncProgress[] = [];
  await planSync(local, remote, state, (progress) => updates.push(progress), undefined, 2);
  assert.deepEqual(updates[0], { phase: 'listing', processed: 0, activePaths: [] });
  assert.deepEqual(updates.at(-1), { phase: 'preview', processed: 3, total: 3, activePaths: [] });
});
