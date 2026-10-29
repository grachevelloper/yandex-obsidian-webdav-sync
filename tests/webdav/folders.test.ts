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
  const replies = [response(405), response(405), response(207, root), response(207, notes)];
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
    const { store } = client([response(405), response(405), response(207, xml)]);
    await assert.rejects(store.list(), /folder/);
  }
});

test('does not turn an inaccessible listing into an empty vault', async () => {
  const { store } = client([response(405), response(405), response(403)]);
  await assert.rejects(store.list(), /403/);
});
