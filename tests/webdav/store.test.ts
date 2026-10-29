import assert from 'node:assert/strict';
import { test } from 'node:test';
import { snapshot } from '../../src/sync/snapshot';
import { client, response } from './fixtures';

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
  await assert.rejects(store.write('note.md', new ArrayBuffer(0), undefined), /changed/);
  assert.equal(requests.filter((request) => request.method === 'PUT').length, 1);
});

test('distinguishes a missing file from authentication and network failures', async () => {
  assert.equal(await client([response(404)]).store.read('note.md'), undefined);
  await assert.rejects(client([response(401)]).store.read('note.md'), /401/);
  await assert.rejects(client([response(503)]).store.read('note.md'), /503/);
});
