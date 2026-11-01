import { clock } from './timing';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebDavStore } from '../../src/webdav/store';
import type { HttpRequest } from '../../src/webdav/client';
import { client, listing, response } from './fixtures';

test('lists nested folders while excluding service directories', async () => {
  const base = '/Obsidian/%D0%A2%D0%B5%D1%81%D1%82';
  const combine = (...documents: string[]) =>
    '<d:multistatus xmlns:d="DAV:">' +
    documents
      .map((xml) => xml.slice(xml.indexOf('<d:response>'), xml.indexOf('</d:multistatus>')))
      .join('') +
    '</d:multistatus>';
  const root = combine(
    listing(base, '<d:collection/>'),
    listing(`${base}/notes/`, '<d:collection/>'),
    listing(`${base}/.obsidian/`, '<d:collection/>'),
  );
  const notes = combine(
    listing(`${base}/notes/`, '<d:collection/>'),
    listing(`${base}/notes/a.md`),
  );
  const replies = [response(207, root), response(207, notes)];
  const requests: HttpRequest[] = [];
  const store = new WebDavStore(
    { login: 'user', password: 'secret', folder: 'Obsidian/Тест' },
    async (request) => {
      requests.push(request);
      const reply = replies.shift();
      assert.ok(reply);
      return reply;
    },
    (path) => !path.split('/').some((part) => part.startsWith('.')),
    undefined,
    { timing: clock() },
  );

  assert.deepEqual(await store.list(), [{ path: 'notes/a.md', size: 4 }]);
  assert.equal(requests.filter((request) => request.method === 'PROPFIND').length, 2);
  await assert.rejects(store.read('notes'), /folder/);
});

test('rejects incomplete or incorrectly nested folder responses', async () => {
  const base = '/Obsidian/%D0%A2%D0%B5%D1%81%D1%82';
  for (const xml of [
    listing(`${base}/note.md`),
    listing(base, '<d:collection/>').replace(
      '</d:multistatus>',
      listing(`${base}/nested/note.md`).slice(
        listing(`${base}/nested/note.md`).indexOf('<d:response>'),
      ),
    ),
  ]) {
    const { store } = client([response(207, xml)]);
    await assert.rejects(store.list(), /folder/);
  }
});

test('does not turn an inaccessible listing into an empty vault', async () => {
  const { store } = client([response(403)]);
  await assert.rejects(store.list(), /403/);
});

test('listing is read-only even if the selected remote folder does not exist', async () => {
  const { store, requests } = client([response(404)]);
  assert.deepEqual(await store.list(), []);
  assert.deepEqual(
    requests.map(({ method }) => method),
    ['PROPFIND'],
  );
});

test('rejects a nested folder that disappears instead of accepting an incomplete preview', async () => {
  const base = '/Obsidian/%D0%A2%D0%B5%D1%81%D1%82';
  const root =
    listing(base, '<d:collection/>').replace('</d:multistatus>', '') +
    listing(`${base}/notes/`, '<d:collection/>').split('<d:multistatus xmlns:d="DAV:">')[1];
  const { store, requests } = client([response(207, root), response(404)]);
  await assert.rejects(store.list(), /404/);
  assert.ok(requests.every(({ method }) => method === 'PROPFIND'));
});

test('shares parent creation across concurrent uploads instead of duplicating MKCOL requests', async () => {
  const requests: HttpRequest[] = [];
  const store = new WebDavStore(
    { login: 'user', password: 'secret', folder: 'Obsidian/Personal' },
    async (request) => {
      requests.push(request);
      await Promise.resolve();
      return response(request.method === 'MKCOL' ? 405 : 201);
    },
    () => true,
    undefined,
    { timing: clock(), concurrentRequests: 2 },
  );
  await Promise.all(
    ['notes/a.md', 'notes/b.md'].map((path) => store.write(path, new ArrayBuffer(0), undefined)),
  );
  const folders = requests.filter(({ method }) => method === 'MKCOL');
  assert.equal(folders.length, 3);
  assert.equal(new Set(folders.map(({ url }) => url)).size, 3);
  assert.equal(requests.filter(({ method }) => method === 'PUT').length, 2);
});
