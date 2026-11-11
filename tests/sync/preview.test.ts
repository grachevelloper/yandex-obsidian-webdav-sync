import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planSync } from '../../src/sync/plan';
import { executePlan } from '../../src/sync/engine';
import { snapshot } from '../../src/sync/snapshot';
import type { Snapshot, SyncState, SyncStore } from '../../src/sync/types';

class MemoryStore implements SyncStore {
  files = new Map<string, Snapshot>();
  writes: string[] = [];
  baselines = new Map<string, Snapshot>();
  recovered = new Map<string, Snapshot>();

  async readBaseline(path: string) {
    return this.baselines.get(path);
  }

  async saveBaseline(path: string, file: Snapshot) {
    this.baselines.set(path, file);
  }

  async remove(path: string, expected: Snapshot) {
    assert.equal(this.files.get(path)?.hash, expected.hash);
    this.files.delete(path);
  }

  async preserve(file: Snapshot) {
    this.recovered.set(file.hash, file);
  }

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

test('remembers the common note and previews a merge of independent changes', async () => {
  const { local, remote, state } = setup();
  const path = 'meeting.md';
  const original = '# Meeting\n\n09:00\n\nOld item\n\nEnd\n';
  const device = original.replace('09:00', '10:00');
  const disk = original.replace('Old item\n', '');
  const combined = device.replace('Old item\n', '');
  await local.set(path, original);
  await remote.set(path, original);
  await executePlan(local, remote, state, await planSync(local, remote, state), async () => {});

  await local.set(path, device);
  await remote.set(path, disk);
  const plan = await planSync(local, remote, state);
  assert.equal(plan.entries[0]?.action, 'merge');
  assert.equal(local.writes.length + remote.writes.length, 0);

  const result = await executePlan(local, remote, state, plan, async () => {});
  assert.deepEqual(result.errors, []);
  assert.equal(result.merged, 1);
  assert.equal(new TextDecoder().decode((await local.read(path))?.data), combined);
  assert.equal(new TextDecoder().decode((await remote.read(path))?.data), combined);
  assert.equal(new TextDecoder().decode((await local.readBaseline(path))?.data), combined);
});

test('keeps separate changes while asking about competing insertions at the end', async () => {
  const { local, remote, state } = setup();
  const path = 'meeting.md';
  const original = '# Meeting\n\nAgenda\n';
  await local.set(path, original);
  await remote.set(path, original);
  await executePlan(local, remote, state, await planSync(local, remote, state), async () => {});
  await local.set(path, '# Planning\n\nAgenda\nDevice note\n');
  await remote.set(path, original + 'Disk note\n');

  const plan = await planSync(local, remote, state);
  assert.equal(plan.entries[0]?.action, 'conflict');
  assert.deepEqual(plan.entries[0]?.merge, [
    { text: '# Planning\n\nAgenda\n' },
    { local: 'Device note\n', remote: 'Disk note\n', base: '' },
  ]);
});

test('pairs an unambiguous move and leaves a single file on both sides after confirmation', async () => {
  const { local, remote, state } = setup();
  const from = 'Plans/note.md';
  const to = 'Archive/note.md';
  await remote.set(from, 'shared note');
  const original = await remote.read(from);
  assert.ok(original);
  state.hashes[from] = original.hash;
  await local.set(to, 'shared note');

  const plan = await planSync(local, remote, state);
  assert.equal(plan.entries.length, 1);
  assert.equal(plan.entries[0]?.action, 'move');
  assert.equal(plan.entries[0]?.move?.targetPath, to);
  assert.ok(await remote.read(from));
  assert.equal(await remote.read(to), undefined);

  const result = await executePlan(local, remote, state, plan, async () => {});
  assert.deepEqual(result.errors, []);
  assert.equal(result.moved, 1);
  assert.deepEqual([...local.files.keys()], [to]);
  assert.deepEqual([...remote.files.keys()], [to]);
  assert.equal(state.hashes[from], undefined);
  assert.equal(state.hashes[to], original.hash);
});

test('leaves multiple matching paths for review instead of guessing a move', async () => {
  const { local, remote, state } = setup();
  const originalPath = 'note.md';
  const newPaths = ['first/note.md', 'second/note.md'];
  await remote.set(originalPath, 'shared text');
  const original = await remote.read(originalPath);
  assert.ok(original);
  state.hashes[originalPath] = original.hash;
  for (const path of newPaths) await local.set(path, 'shared text');

  const plan = await planSync(local, remote, state);
  const originalEntry = plan.entries.find((entry) => entry.path === originalPath);
  assert.equal(originalEntry?.action, 'download');
  assert.match(originalEntry.message ?? '', /Several files match/);
  assert.equal(plan.entries.length, 3);
  assert.equal(
    plan.entries.some((entry) => entry.action === 'move'),
    false,
  );
});

test('renames an incoming file after confirmation and refuses a newly occupied name', async () => {
  for (const occupied of [false, true]) {
    const { local, remote, state } = setup();
    const from = 'Plans/note.md';
    const to = 'Plans/renamed.md';
    await remote.set(from, 'shared note');
    const plan = await planSync(local, remote, state);
    const entry = plan.entries[0];
    assert.ok(entry);
    entry.renameTo = to;
    if (occupied) await local.set(to, 'unrelated file');

    const result = await executePlan(local, remote, state, plan, async () => {});
    if (occupied) {
      assert.equal(result.errors.length, 1);
      assert.ok(await remote.read(from));
      assert.equal(await remote.read(to), undefined);
      assert.equal(new TextDecoder().decode((await local.read(to))?.data), 'unrelated file');
    } else {
      assert.deepEqual(result.errors, []);
      assert.equal(result.renamed, 1);
      assert.deepEqual([...local.files.keys()], [to]);
      assert.deepEqual([...remote.files.keys()], [to]);
      assert.equal(new TextDecoder().decode((await local.read(to))?.data), 'shared note');
    }
  }
});

test('keeps both original and destination copies if removing a moved source fails', async () => {
  const { local, remote, state } = setup();
  const from = 'Plans/note.md';
  const to = 'Archive/note.md';
  await remote.set(from, 'shared note');
  const original = await remote.read(from);
  assert.ok(original);
  state.hashes[from] = original.hash;
  await local.set(to, 'shared note');
  const plan = await planSync(local, remote, state);
  remote.remove = async () => {
    throw new Error('Deletion failed');
  };

  const result = await executePlan(local, remote, state, plan, async () => {});
  assert.match(result.errors[0] ?? '', /Deletion failed/);
  assert.equal(result.moved, undefined);
  assert.deepEqual(await remote.read(from), original);
  assert.deepEqual(await remote.read(to), original);
  assert.deepEqual(await local.read(to), original);
  assert.deepEqual(local.recovered.get(original.hash), original);
  assert.equal(state.hashes[from], original.hash);
  assert.equal(state.hashes[to], undefined);
});

test('falls back to manual conflict review when the common text is missing or unreadable', async () => {
  const cases = ['missing', 'unreadable'] as const;
  for (const availability of cases) {
    const { local, remote, state } = setup();
    const path = 'note.md';
    await local.set(path, 'local edit');
    await remote.set(path, 'remote edit');
    const original = await snapshot(new TextEncoder().encode('original').buffer);
    state.hashes[path] = original.hash;
    if (availability === 'unreadable')
      local.readBaseline = async () => {
        throw new Error('Storage unavailable');
      };

    const plan = await planSync(local, remote, state);
    assert.equal(plan.entries[0]?.action, 'conflict');
    assert.equal(plan.entries[0]?.merge, undefined);
    assert.equal(local.writes.length + remote.writes.length, 0);
  }
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

test('stopping preview is not converted into file errors or an approvable plan', async () => {
  const { local, remote, state } = setup();
  await local.set('a.md', 'a');
  await local.set('b.md', 'b');
  const controller = new AbortController();
  const reads: string[] = [];
  remote.read = async (path) => {
    reads.push(path);
    controller.abort();
    return undefined;
  };
  await assert.rejects(
    planSync(local, remote, state, undefined, undefined, 1, controller.signal),
    /cancelled/i,
  );
  assert.deepEqual(reads, ['a.md']);
  assert.deepEqual(state.hashes, {});
});

test('stopping during a write preserves its completed baseline and does not start the next file', async () => {
  const { local, remote, state } = setup();
  await local.set('a.md', 'a');
  await local.set('b.md', 'b');
  const plan = await planSync(local, remote, state);
  const controller = new AbortController();
  const write = remote.write.bind(remote);
  remote.write = async (...args) => {
    controller.abort();
    await write(...args);
  };
  let checkpoints = 0;
  await assert.rejects(
    executePlan(
      local,
      remote,
      state,
      plan,
      async () => {
        checkpoints++;
      },
      undefined,
      undefined,
      1,
      controller.signal,
    ),
    /cancelled/i,
  );
  assert.deepEqual(remote.writes, ['a.md']);
  assert.equal(state.hashes['a.md'], local.files.get('a.md')?.hash);
  assert.equal(checkpoints, 1);
});

test('a cancelled parallel reader cannot discard a completed writer checkpoint', async () => {
  const { local, remote, state } = setup();
  await local.set('a.md', 'a');
  await local.set('b.md', 'b');
  const plan = await planSync(local, remote, state);
  const controller = new AbortController();
  let releaseRead = () => {};
  let releaseWrite = () => {};
  const readBlocked = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const writeBlocked = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  const write = remote.write.bind(remote);
  remote.read = async (path) => {
    if (path === 'a.md') await readBlocked;
    return undefined;
  };
  remote.write = async (...args) => {
    await writeBlocked;
    await write(...args);
  };
  let savedHash: string | undefined;
  const running = executePlan(
    local,
    remote,
    state,
    plan,
    async () => {
      savedHash = state.hashes['b.md'];
    },
    undefined,
    undefined,
    2,
    controller.signal,
  );
  const rejected = assert.rejects(running, /cancelled/i);
  await new Promise<void>((resolve) => setImmediate(resolve));
  controller.abort();
  releaseRead();
  await new Promise<void>((resolve) => setImmediate(resolve));
  releaseWrite();
  await rejected;
  assert.deepEqual(remote.writes, ['b.md']);
  assert.equal(savedHash, local.files.get('b.md')?.hash);
});

test('stopping while saving a conflict copy preserves the original and both versions', async () => {
  const { local, remote, state } = setup();
  await local.set('a.md', 'local edit');
  await remote.set('a.md', 'cloud edit');
  const plan = await planSync(local, remote, state);
  const controller = new AbortController();
  const write = local.write.bind(local);
  local.write = async (...args) => {
    await write(...args);
    controller.abort();
  };
  await assert.rejects(
    executePlan(
      local,
      remote,
      state,
      plan,
      async () => {},
      undefined,
      undefined,
      1,
      controller.signal,
    ),
    /cancelled/i,
  );
  assert.equal(new TextDecoder().decode(local.files.get('a.md')?.data), 'local edit');
  assert.equal(new TextDecoder().decode(remote.files.get('a.md')?.data), 'cloud edit');
  assert.equal(remote.writes.length, 0);
  assert.deepEqual(state.hashes, {});
});
