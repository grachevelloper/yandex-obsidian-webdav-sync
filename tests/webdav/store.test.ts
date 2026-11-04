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
  assert.equal(requests[0]?.headers['Cache-Control'], 'no-cache');
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
  await assert.rejects(store.write('note.md', new ArrayBuffer(0), undefined), /HTTP 412/);
  assert.equal(requests.filter((request) => request.method === 'PUT').length, 1);
});

test('distinguishes a missing file from authentication and network failures', async () => {
  assert.equal(await client([response(404)]).store.read('note.md'), undefined);
  await assert.rejects(client([response(401)]).store.read('note.md'), /401/);
  await assert.rejects(client([response(503)]).store.read('note.md'), /503/);
});

test('DELETE requires a strong If-Match and never falls back after a stale revision', async () => {
  const { store, requests } = client([response(412)]);
  const file = await snapshot(new TextEncoder().encode('old').buffer, '"old-version"');
  await assert.rejects(store.remove('note.md', file), /HTTP 412/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.method, 'DELETE');
  assert.equal(requests[0]?.headers['If-Match'], '"old-version"');
  const withoutTag = await snapshot(new TextEncoder().encode('old').buffer);
  await assert.rejects(store.remove('note.md', withoutTag), /strong/);
  assert.equal(requests.length, 1);
});
