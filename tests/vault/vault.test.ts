import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FileManager, TFile, Vault } from 'obsidian';
import { VaultStore } from '../../src/vault/store';
import { snapshot } from '../../src/sync/snapshot';

function setup(baselineFolder?: string) {
  const files = new Map<string, ArrayBuffer>();
  const folders = new Set<string>();
  const trashed: string[] = [];
  const renamed: [string, string][] = [];
  const fileManager = {
    renameFile: async (entry: TFile, target: string) => {
      const data = files.get(entry.path);
      assert.ok(data);
      assert.equal(files.has(target), false);
      renamed.push([entry.path, target]);
      files.set(target, data);
      files.delete(entry.path);
    },
    trashFile: async (entry: TFile) => {
      const data = files.get(entry.path);
      assert.ok(data);
      const before = await snapshot(data);
      assert.deepEqual(
        files.get('.obsidian/plugins/yandex-disk-sync/recovery/' + before.hash),
        data,
      );
      trashed.push(entry.path);
      files.delete(entry.path);
    },
  };
  const file = (path: string) => ({ path, stat: { size: files.get(path)?.byteLength ?? 0 } });
  const vault = {
    configDir: '.obsidian',
    getFiles: () => [...files.keys()].map(file),
    getFileByPath: (path: string) => (files.has(path) ? file(path) : null),
    getAbstractFileByPath: (path: string) =>
      files.has(path) ? file(path) : folders.has(path) ? { path, children: [] } : null,
    readBinary: async (entry: TFile) => files.get(entry.path),
    trash: async () => {
      throw new Error('Deletion must respect the Obsidian trash preference');
    },
    createBinary: async (path: string, data: ArrayBuffer) => {
      assert.equal(files.has(path), false);
      files.set(path, data);
    },
    modifyBinary: async (entry: TFile, data: ArrayBuffer) => {
      files.set(entry.path, data);
    },
    createFolder: async (path: string) => {
      await Promise.resolve();
      assert.equal(folders.has(path), false, 'Obsidian rejects duplicate folder creation');
      folders.add(path);
    },
    process: async (entry: TFile, transform: (content: string) => string) => {
      const before = files.get(entry.path);
      const after = transform(new TextDecoder().decode(before));
      files.set(entry.path, new TextEncoder().encode(after).buffer);
      return after;
    },
    adapter: {
      exists: async (path: string) => folders.has(path) || files.has(path),
      mkdir: async (path: string) => {
        await Promise.resolve();
        assert.equal(folders.has(path), false, 'Adapter rejects duplicate directory creation');
        folders.add(path);
      },
      readBinary: async (path: string) => files.get(path),
      stat: async (path: string) => {
        const data = files.get(path);
        return data ? { type: 'file', size: data.byteLength } : null;
      },
      remove: async (path: string) => {
        files.delete(path);
      },
      writeBinary: async (path: string, data: ArrayBuffer) => {
        files.set(path, data);
      },
    },
  };
  // Obsidian supplies the remaining host APIs; the test implements only the exercised surface.
  const store = new VaultStore(
    vault as unknown as Vault,
    fileManager as unknown as FileManager,
    '.obsidian/plugins/yandex-disk-sync/recovery',
    undefined,
    baselineFolder,
  );
  const bytes = (value: string) => new TextEncoder().encode(value).buffer;

  return { store, files, bytes, trashed, renamed };
}

test('creates nested notes and preserves binary bytes', async () => {
  const { store, files } = setup();
  const data = new Uint8Array([0, 255, 0, 128]).buffer;
  await store.write('images/photo.png', data, undefined);
  assert.deepEqual(files.get('images/photo.png'), data);
});

test('rejects files edited after scanning', async () => {
  const { store, files, bytes } = setup();
  const expected = await snapshot(bytes('old'));
  files.set('note.md', bytes('new local edit'));
  await assert.rejects(store.write('note.md', bytes('remote'), expected), /changed/);
  assert.deepEqual(files.get('note.md'), bytes('new local edit'));
});

test('refuses to overwrite a file that appeared after a missing-file read', async () => {
  const { store, files, bytes } = setup();
  files.set('note.md', bytes('local'));
  await assert.rejects(store.write('note.md', bytes('remote'), undefined), /changed/);
});

test('backs up the replaced version outside synchronized files', async () => {
  const { store, files, bytes } = setup();
  files.set('note.md', bytes('old'));
  const before = await store.read('note.md');
  assert.ok(before);
  await store.write('note.md', bytes('new'), before);

  assert.deepEqual(files.get('note.md'), bytes('new'));
  assert.deepEqual(
    files.get(`.obsidian/plugins/yandex-disk-sync/recovery/${before.hash}`),
    bytes('old'),
  );
  assert.deepEqual(
    (await store.list()).map((file) => file.path),
    ['note.md'],
  );
});

test('keeps one private shared text per path and can remove it when the path changes', async () => {
  const folder = '.obsidian/plugins/yandex-disk-sync/common-text';
  const { store, files, bytes } = setup(folder);
  const path = 'note.md';
  const first = await snapshot(bytes('first text'));
  const last = await snapshot(bytes('shared text'));
  await store.saveBaseline(path, first);
  await store.saveBaseline(path, last);

  assert.deepEqual(await store.readBaseline(path), last);
  assert.equal([...files.keys()].filter((name) => name.startsWith(folder + '/')).length, 1);
  assert.deepEqual(await store.list(), []);

  await store.forgetBaseline(path);
  assert.equal(await store.readBaseline(path), undefined);
});

test('restores a separate copy without replacing the current note', async () => {
  const { store, files, bytes } = setup();
  const original = await snapshot(bytes('old text'));
  await store.preserve(original);
  files.set('note.md', bytes('current text'));
  const restored = await store.restoreCopy('note.md', original.hash);
  assert.notEqual(restored, 'note.md');
  assert.deepEqual(files.get(restored), original.data);
  assert.deepEqual(files.get('note.md'), bytes('current text'));
  files.set(restored, bytes('another note'));
  await assert.rejects(store.restoreCopy('note.md', original.hash), /already in use/);
  assert.deepEqual(files.get(restored), bytes('another note'));
});

test('creates shared parent folders once when downloading two files concurrently', async () => {
  const { store, files, bytes } = setup();
  await Promise.all([
    store.write('notes/nested/a.md', bytes('a'), undefined),
    store.write('notes/nested/b.md', bytes('b'), undefined),
  ]);
  assert.deepEqual(files.get('notes/nested/a.md'), bytes('a'));
  assert.deepEqual(files.get('notes/nested/b.md'), bytes('b'));
});

test('shares recovery-folder creation during concurrent local replacements', async () => {
  const { store, files, bytes } = setup();
  files.set('a.md', bytes('old a'));
  files.set('b.md', bytes('old b'));
  const first = await store.read('a.md');
  const second = await store.read('b.md');
  assert.ok(first && second);
  await Promise.all([
    store.write('a.md', bytes('new a'), first),
    store.write('b.md', bytes('new b'), second),
  ]);
  assert.deepEqual(
    files.get(`.obsidian/plugins/yandex-disk-sync/recovery/${first.hash}`),
    bytes('old a'),
  );
  assert.deepEqual(
    files.get(`.obsidian/plugins/yandex-disk-sync/recovery/${second.hash}`),
    bytes('old b'),
  );
});

test('mirror deletion preserves recovery bytes and uses the configured trash after checking edits', async () => {
  const { store, files, bytes, trashed } = setup();
  files.set('note.md', bytes('before'));
  const old = await store.read('note.md');
  assert.ok(old);
  files.set('note.md', bytes('new edit'));
  await assert.rejects(store.remove('note.md', old), /changed/);
  assert.ok(files.has('note.md'));
  assert.deepEqual(trashed, []);
  const current = await store.read('note.md');
  assert.ok(current);
  await store.remove('note.md', current);
  assert.equal(files.has('note.md'), false);
  assert.deepEqual(trashed, ['note.md']);
  assert.deepEqual(
    files.get('.obsidian/plugins/yandex-disk-sync/recovery/' + current.hash),
    bytes('new edit'),
  );
});

test('moves a note through the file manager and refuses stale sources or occupied targets', async () => {
  const cases = ['unchanged', 'edited', 'occupied'] as const;
  for (const change of cases) {
    const { store, files, bytes, renamed } = setup();
    const from = 'Notes/original.md';
    const to = 'Archive/renamed.md';
    files.set(from, bytes('original text'));
    const original = await store.read(from);
    assert.ok(original);
    if (change === 'edited') files.set(from, bytes('new edit'));
    if (change === 'occupied') files.set(to, bytes('another note'));

    if (change === 'unchanged') {
      await store.move(from, to, original);
      assert.deepEqual(renamed, [[from, to]]);
      assert.equal(files.has(from), false);
      assert.deepEqual(files.get(to), original.data);
    } else {
      await assert.rejects(store.move(from, to, original), /changed/);
      assert.deepEqual(renamed, []);
      assert.deepEqual(files.get(from), bytes(change === 'edited' ? 'new edit' : 'original text'));
      assert.deepEqual(files.get(to), change === 'occupied' ? bytes('another note') : undefined);
    }
  }
});
