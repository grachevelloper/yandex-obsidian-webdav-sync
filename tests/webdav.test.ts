import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebDavStore, type HttpRequest, type HttpResponse } from '../src/webdav/store';
import { parseListing } from '../src/webdav/listing';
import { snapshot } from '../src/sync/engine';

function response(status: number, text = '', headers: Record<string, string> = {}): HttpResponse {
  return { status, text, headers, arrayBuffer: new TextEncoder().encode(text).buffer };
}

function client(replies: HttpResponse[]) {
  const requests: HttpRequest[] = [];
  const store = new WebDavStore(
    { login: 'user', password: 'secret', folder: 'Obsidian/Тест' },
    async (request) => {
      requests.push(request);
      const reply = replies.shift();
      assert.ok(reply, `Unexpected ${request.method}`);
      return reply;
    },
    () => true,
  );

  return { store, requests };
}

const listing = (href: string, type = '', size = '4') => `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:"><d:response><d:href>${href}</d:href>
<d:propstat><d:prop><d:resourcetype>${type}</d:resourcetype><d:getcontentlength>${size}</d:getcontentlength></d:prop>
<d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;

test('parses namespace XML, percent escapes and XML entities without altering names', () => {
  const entries = parseListing(
    listing('/Obsidian/%D0%A2%D0%B5%D1%81%D1%82/a%20%23%25&amp;b.md'),
    'Obsidian/Тест',
  );
  assert.deepEqual(entries, [{ path: 'a #%&b.md', size: 4, directory: false }]);
});

test('rejects unsafe, malformed, out-of-scope and incomplete listings', () => {
  for (const xml of [
    '<broken>',
    listing('/elsewhere/file.md'),
    listing('/Obsidian/Тест/a%2Fb.md'),
    listing('/Obsidian/Тест/file.md', '', 'oops'),
    '<!DOCTYPE x [<!ENTITY a "test">]>' + listing('/Obsidian/Тест/a.md'),
    listing('/Obsidian/Тест/a.md').replace('200 OK', '403 Forbidden'),
  ]) {
    assert.throws(() => parseListing(xml, 'Obsidian/Тест'));
  }
});

test('GET captures an ETag and safely encodes Unicode, hash and percent in paths', async () => {
  const { store, requests } = client([response(200, 'data', { ETag: '"v1"' })]);
  const file = await store.read('folder/a #%.md');

  assert.equal(file?.revision, '"v1"');
  assert.equal(
    requests[0]?.url,
    'https://webdav.yandex.ru/Obsidian/%D0%A2%D0%B5%D1%81%D1%82/folder/a%20%23%25.md',
  );
  assert.ok(requests[0]?.headers.Authorization?.startsWith('Basic '));
});

test('uses conditional PUT for new files and existing revisions', async () => {
  const expected = await snapshot(new TextEncoder().encode('old').buffer, '"v1"');
  for (const previous of [undefined, expected]) {
    const { store, requests } = client([response(201), response(201), response(201)]);
    await store.write('note.md', new TextEncoder().encode('new').buffer, previous);
    const put = requests.find((request) => request.method === 'PUT');
    assert.equal(put?.headers[previous ? 'If-Match' : 'If-None-Match'], previous ? '"v1"' : '*');
  }
});

test('refuses unsafe overwrites without a strong revision', async () => {
  for (const revision of [undefined, 'W/"weak"']) {
    const { store, requests } = client([]);
    await assert.rejects(
      store.write('note.md', new ArrayBuffer(0), await snapshot(new ArrayBuffer(0), revision)),
      /ETag/,
    );
    assert.equal(requests.length, 0);
  }
});

test('rejects stale writes and never retries them unconditionally', async () => {
  const { store, requests } = client([response(201), response(201), response(412)]);
  await assert.rejects(store.write('note.md', new ArrayBuffer(0), undefined), /изменился/);
  assert.equal(requests.filter((request) => request.method === 'PUT').length, 1);
});

test('distinguishes a missing file from authentication and network failures', async () => {
  assert.equal(await client([response(404)]).store.read('note.md'), undefined);
  await assert.rejects(client([response(401)]).store.read('note.md'), /401/);
  await assert.rejects(client([response(503)]).store.read('note.md'), /503/);
});

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
  await assert.rejects(store.read('notes'), /папка/);
});

test('network error details never expose credentials', async () => {
  const store = new WebDavStore(
    { login: 'user', password: 'secret', folder: 'Obsidian' },
    async () => {
      throw new Error('secret and Authorization header');
    },
    () => true,
  );
  await assert.rejects(
    store.read('note.md'),
    (error) => error instanceof Error && !error.message.includes('secret'),
  );
});
