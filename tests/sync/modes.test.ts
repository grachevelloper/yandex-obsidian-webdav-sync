import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planSync } from '../../src/sync/plan';
import { executePlan } from '../../src/sync/engine';
import { snapshot } from '../../src/sync/snapshot';
import type { Snapshot, SyncMode, SyncState, SyncStore } from '../../src/sync/types';

class Store implements SyncStore {
  files = new Map<string, Snapshot>();
  recovery = new Map<string, ArrayBuffer>();
  writes: string[] = [];
  removals: string[] = [];

  async set(path: string, text: string) {
    this.files.set(path, await snapshot(new TextEncoder().encode(text).buffer));
  }

  async list() {
    return [...this.files].map(([path, file]) => ({ path, size: file.data.byteLength }));
  }

  async read(path: string) {
    return this.files.get(path);
  }

  async preserve(file: Snapshot) {
    this.recovery.set(file.hash, file.data);
  }

  async write(path: string, data: ArrayBuffer, expected: Snapshot | undefined) {
    assert.equal(this.files.get(path)?.hash, expected?.hash);
    this.files.set(path, await snapshot(data));
    this.writes.push(path);
  }

  async remove(path: string, expected: Snapshot) {
    assert.equal(this.files.get(path)?.hash, expected.hash);
    this.files.delete(path);
    this.removals.push(path);
  }
}

async function setup(mode: SyncMode) {
  const local = new Store();
  const remote = new Store();
  const state: SyncState = { version: 1, scope: 'test', hashes: {} };
  await local.set('both.md', 'local');
  await remote.set('both.md', 'cloud');
  await local.set('local.md', 'device only');
  await remote.set('remote.md', 'cloud only');
  const plan = await planSync(local, remote, state, undefined, undefined, 1, undefined, mode);

  return { local, remote, state, plan };
}

test('device mirror previews replacements and remote deletions before changing anything', async () => {
  const { local, remote, state, plan } = await setup('device-wins');
  assert.deepEqual(
    plan.entries.map(({ path, action }) => [path, action]),
    [
      ['both.md', 'upload'],
      ['local.md', 'upload'],
      ['remote.md', 'delete-remote'],
    ],
  );
  assert.equal(local.writes.length + remote.writes.length + remote.removals.length, 0);
  const oldCloud = remote.files.get('both.md');
  const oldRemoteOnly = remote.files.get('remote.md');
  assert.ok(oldCloud && oldRemoteOnly);
  const result = await executePlan(local, remote, state, plan, async () => {});
  assert.equal(result.deletedRemote, 1);
  assert.deepEqual(local.files, remote.files);
  assert.ok(local.recovery.has(oldCloud.hash));
  assert.ok(local.recovery.has(oldRemoteOnly.hash));
  assert.equal(local.writes.length + local.removals.length, 0);
});

test('cloud mirror changes only the device and removes device-only files', async () => {
  const { local, remote, state, plan } = await setup('cloud-wins');
  const result = await executePlan(local, remote, state, plan, async () => {});
  assert.equal(result.deletedLocal, 1);
  assert.deepEqual(local.files, remote.files);
  assert.equal(remote.writes.length + remote.removals.length, 0);
});

test('two-way sync never proposes or accepts deletion actions', async () => {
  const { local, remote, state, plan } = await setup('two-way');
  assert.equal(
    plan.entries.some((entry) => entry.action.startsWith('delete')),
    false,
  );
  plan.entries = [
    { path: 'local.md', action: 'delete-local', localHash: local.files.get('local.md')?.hash },
  ];
  await assert.rejects(
    executePlan(local, remote, state, plan, async () => {}),
    /mode|delet/i,
  );
  assert.equal(local.removals.length, 0);
});

test('a file appearing on the source after preview blocks a destination deletion', async () => {
  const { local, remote, state, plan } = await setup('device-wins');
  await local.set('remote.md', 'new device edit');
  const result = await executePlan(local, remote, state, plan, async () => {});
  assert.equal(remote.removals.length, 0);
  assert.ok(result.errors.some((error) => error.includes('remote.md')));
});

test('edited conflict result replaces the original on both sides without conflict-copy files', async () => {
  const { local, remote, state, plan } = await setup('two-way');
  const conflict = plan.entries.find((entry) => entry.action === 'conflict');
  assert.ok(conflict);
  conflict.resolution = { kind: 'text', text: '# Edited together' };
  const before = [local.files.get('both.md'), remote.files.get('both.md')];
  const result = await executePlan(local, remote, state, plan, async () => {});
  assert.equal(result.resolved, 1);
  assert.equal(new TextDecoder().decode(local.files.get('both.md')?.data), '# Edited together');
  assert.equal(local.files.get('both.md')?.hash, remote.files.get('both.md')?.hash);
  assert.equal(
    [...local.files.keys()].some((path) => path.includes('.conflict-')),
    false,
  );
  assert.ok(before.every((file) => file && local.recovery.has(file.hash)));
});

test('a newer cloud version blocks an edited conflict resolution', async () => {
  const { local, remote, state, plan } = await setup('two-way');
  const conflict = plan.entries.find((entry) => entry.action === 'conflict');
  assert.ok(conflict);
  conflict.resolution = { kind: 'text', text: 'approved' };
  await remote.set('both.md', 'new cloud edit');
  const result = await executePlan(local, remote, state, plan, async () => {});
  assert.ok(result.errors.some((error) => error.includes('both.md')));
  assert.equal(new TextDecoder().decode(remote.files.get('both.md')?.data), 'new cloud edit');
});

test('skipped conflicts keep both originals and leave the baseline unchanged', async () => {
  const { local, remote, state, plan } = await setup('two-way');
  const conflict = plan.entries.find((entry) => entry.action === 'conflict');
  assert.ok(conflict);
  conflict.resolution = { kind: 'skip' };
  const result = await executePlan(local, remote, state, plan, async () => {});
  assert.ok(result.skipped.includes('both.md'));
  assert.notEqual(local.files.get('both.md')?.hash, remote.files.get('both.md')?.hash);
  assert.equal(state.hashes['both.md'], undefined);
});

test('failed local resolution write preserves both originals and reports the completed cloud transfer', async () => {
  const { local, remote, state, plan } = await setup('two-way');
  const conflict = plan.entries.find((entry) => entry.action === 'conflict');
  assert.ok(conflict);
  plan.entries = [conflict];
  conflict.resolution = { kind: 'text', text: 'edited result' };
  const original = local.files.get('both.md');
  assert.ok(original);
  local.write = async () => {
    throw new Error('Local file changed');
  };
  const result = await executePlan(local, remote, state, plan, async () => {});
  assert.equal(result.uploaded, 1);
  assert.equal(result.downloaded, 0);
  assert.equal(result.errors.length, 1);
  assert.equal(local.files.get('both.md')?.hash, original.hash);
  assert.equal(state.hashes['both.md'], undefined);
  assert.equal(local.recovery.size, 2);
});

test('a recovery failure prevents the conflict overwrite before either side changes', async () => {
  const { local, remote, state, plan } = await setup('two-way');
  const conflict = plan.entries.find((entry) => entry.action === 'conflict');
  assert.ok(conflict);
  plan.entries = [conflict];
  conflict.resolution = { kind: 'text', text: 'edited result' };
  local.preserve = async () => {
    throw new Error('Disk full');
  };
  const result = await executePlan(local, remote, state, plan, async () => {});
  assert.equal(result.errors.length, 1);
  assert.equal(local.writes.length + remote.writes.length, 0);
});

test('stopping after the remote resolution write keeps local edits and completed transfer totals', async () => {
  const { SyncCancelled } = await import('../../src/sync/errors');
  const { local, remote, state, plan } = await setup('two-way');
  const conflict = plan.entries.find((entry) => entry.action === 'conflict');
  assert.ok(conflict);
  plan.entries = [conflict];
  conflict.resolution = { kind: 'text', text: 'edited result' };
  const controller = new AbortController();
  const write = remote.write.bind(remote);
  remote.write = async (...args) => {
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
    (error: unknown) => {
      assert.ok(error instanceof SyncCancelled);
      assert.equal(error.result?.uploaded, 1);
      return true;
    },
  );
  assert.equal(new TextDecoder().decode(local.files.get('both.md')?.data), 'local');
  assert.equal(state.hashes['both.md'], undefined);
  assert.equal(local.recovery.size, 2);
});

test('an explicitly empty edited result is saved as an empty file on both sides', async () => {
  const { local, remote, state, plan } = await setup('two-way');
  const conflict = plan.entries.find((entry) => entry.action === 'conflict');
  assert.ok(conflict);
  plan.entries = [conflict];
  conflict.resolution = { kind: 'text', text: '' };
  const result = await executePlan(local, remote, state, plan, async () => {});
  assert.equal(result.resolved, 1);
  assert.equal(local.files.get('both.md')?.data.byteLength, 0);
  assert.equal(remote.files.get('both.md')?.data.byteLength, 0);
});

test('mirror deletion refuses a destination edited after preview', async () => {
  const { local, remote, state, plan } = await setup('device-wins');
  await remote.set('remote.md', 'new remote edit');
  const result = await executePlan(local, remote, state, plan, async () => {});
  assert.equal(remote.removals.length, 0);
  assert.ok(result.errors.some((error) => error.includes('remote.md')));
});

test('a completed deletion is checkpointed even when Stop is pressed during its request', async () => {
  const { local, remote, state, plan } = await setup('device-wins');
  plan.entries = plan.entries.filter((entry) => entry.action === 'delete-remote');
  const controller = new AbortController();
  const remove = remote.remove.bind(remote);
  remote.remove = async (...args) => {
    await remove(...args);
    controller.abort();
  };
  let saved = 0;
  await assert.rejects(
    executePlan(
      local,
      remote,
      state,
      plan,
      async () => {
        saved++;
      },
      undefined,
      undefined,
      1,
      controller.signal,
    ),
    /cancelled/,
  );
  assert.equal(saved, 1);
  assert.deepEqual(remote.removals, ['remote.md']);
});

test('editing an incoming-only file stages the edited result on both sides', async () => {
  const { local, remote, state, plan } = await setup('two-way');
  const entry = plan.entries.find((file) => file.path === 'remote.md');
  assert.ok(entry);
  plan.entries = [entry];
  entry.resolution = { kind: 'text', text: 'reviewed incoming text' };
  const result = await executePlan(local, remote, state, plan, async () => {});
  assert.deepEqual(result.errors, []);
  assert.equal(
    new TextDecoder().decode(local.files.get('remote.md')?.data),
    'reviewed incoming text',
  );
  assert.equal(
    new TextDecoder().decode(remote.files.get('remote.md')?.data),
    'reviewed incoming text',
  );
});

test('a file proposed for download can instead keep the local version on both sides', async () => {
  const { local, remote, state } = await setup('two-way');
  state.hashes['both.md'] = local.files.get('both.md')?.hash ?? '';
  const plan = await planSync(local, remote, state);
  const entry = plan.entries.find((file) => file.path === 'both.md');
  assert.ok(entry);
  assert.equal(entry.action, 'download');
  plan.entries = [entry];
  entry.resolution = { kind: 'local' };
  const result = await executePlan(local, remote, state, plan, async () => {});
  assert.deepEqual(result.errors, []);
  assert.equal(new TextDecoder().decode(remote.files.get('both.md')?.data), 'local');
});

test('editing a previously unchanged file applies the approved text instead of skipping it', async () => {
  const { local, remote, state } = await setup('two-way');
  await remote.set('both.md', 'local');
  const plan = await planSync(local, remote, state);
  const entry = plan.entries.find((file) => file.path === 'both.md');
  assert.ok(entry);
  assert.equal(entry.action, 'unchanged');
  plan.entries = [entry];
  entry.resolution = { kind: 'text', text: 'edited in preview' };
  await executePlan(local, remote, state, plan, async () => {});
  assert.equal(new TextDecoder().decode(remote.files.get('both.md')?.data), 'edited in preview');
});

test('an explicitly edited mirror file updates both the source and destination', async () => {
  for (const mode of ['device-wins', 'cloud-wins'] as const) {
    const { local, remote, state, plan } = await setup(mode);
    const entry = plan.entries.find((file) => file.path === 'both.md');
    assert.ok(entry);
    plan.entries = [entry];
    entry.resolution = { kind: 'text', text: 'reviewed on both sides' };
    const result = await executePlan(local, remote, state, plan, async () => {});
    assert.deepEqual(result.errors, []);
    assert.equal(
      new TextDecoder().decode(local.files.get('both.md')?.data),
      'reviewed on both sides',
    );
    assert.equal(local.files.get('both.md')?.hash, remote.files.get('both.md')?.hash);
  }
});

test('editing a mirror deletion cancels deletion and saves the approved file on both sides', async () => {
  const { local, remote, state, plan } = await setup('device-wins');
  const entry = plan.entries.find((file) => file.action === 'delete-remote');
  assert.ok(entry);
  plan.entries = [entry];
  entry.resolution = { kind: 'text', text: 'keep this edited note' };
  const result = await executePlan(local, remote, state, plan, async () => {});
  assert.deepEqual(result.errors, []);
  assert.equal(result.deletedRemote ?? 0, 0);
  assert.equal(
    new TextDecoder().decode(local.files.get(entry.path)?.data),
    'keep this edited note',
  );
  assert.equal(local.files.get(entry.path)?.hash, remote.files.get(entry.path)?.hash);
});

test('explicit deletion removes existing versions and preserves them in recovery', async () => {
  const { local, remote, state, plan } = await setup('two-way');
  plan.entries = plan.entries.filter(({ path }) => path !== 'local.md');
  for (const entry of plan.entries) entry.resolution = { kind: 'delete' };
  const originals = [
    ...plan.entries.flatMap(({ path }) => [local.files.get(path), remote.files.get(path)]),
  ];
  const result = await executePlan(local, remote, state, plan, async () => {});
  assert.deepEqual(result.errors, []);
  assert.deepEqual(local.removals, ['both.md']);
  assert.deepEqual(remote.removals, ['both.md', 'remote.md']);
  for (const version of originals) {
    if (version) assert.ok(local.recovery.has(version.hash));
  }
});

test('explicit deletion refuses to remove either version when one changed', async () => {
  const { local, remote, state, plan } = await setup('two-way');
  plan.entries = plan.entries.filter(({ path }) => path === 'both.md');
  for (const entry of plan.entries) entry.resolution = { kind: 'delete' };
  await local.set('both.md', 'changed after preview');
  const result = await executePlan(local, remote, state, plan, async () => {});
  assert.equal(result.errors.length, 1);
  assert.deepEqual(local.removals, []);
  assert.deepEqual(remote.removals, []);
});
