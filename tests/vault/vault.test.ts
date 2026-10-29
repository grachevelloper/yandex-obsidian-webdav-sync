import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TFile, Vault } from 'obsidian';
import { VaultStore } from '../../src/vault/store';
import { snapshot } from '../../src/sync/snapshot';

function setup() {
  const files = new Map<string, ArrayBuffer>();
  const folders = new Set<string>();
  const file = (path: string) => ({ path, stat: { size: files.get(path)?.byteLength ?? 0 } });
  const vault = {
    configDir: '.obsidian',
    getFiles: () => [...files.keys()].map(file),
    getFileByPath: (path: string) => (files.has(path) ? file(path) : null),
    getAbstractFileByPath: (path: string) =>
      files.has(path) ? file(path) : folders.has(path) ? { path, children: [] } : null,
    readBinary: async (entry: TFile) => files.get(entry.path),
    createBinary: async (path: string, data: ArrayBuffer) => {
      assert.equal(files.has(path), false);
      files.set(path, data);
    },
    modifyBinary: async (entry: TFile, data: ArrayBuffer) => {
      files.set(entry.path, data);
    },
    createFolder: async (path: string) => {
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
        folders.add(path);
      },
      writeBinary: async (path: string, data: ArrayBuffer) => {
        files.set(path, data);
      },
    },
  };
  // Obsidian supplies the remaining host APIs; the test implements only the exercised surface.
  const store = new VaultStore(
    vault as unknown as Vault,
    '.obsidian/plugins/yandex-disk-sync/recovery',
  );
  const bytes = (value: string) => new TextEncoder().encode(value).buffer;

  return { store, files, bytes };
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
