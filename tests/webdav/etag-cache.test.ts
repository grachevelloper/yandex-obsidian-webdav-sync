import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebDavStore } from '../../src/webdav/store';
import { emptyRemoteCache } from '../../src/sync/remote-cache';
import { snapshot } from '../../src/sync/snapshot';
import { planSync } from '../../src/sync/plan';
import { executePlan } from '../../src/sync/engine';
import { loadPluginData, scopeFor } from '../../src/settings/data';
import type { HttpRequest } from '../../src/webdav/client';
import type { SyncState, SyncStore } from '../../src/sync/types';
import { response } from './fixtures';
import { clock } from './timing';

const tagA = 'a'.repeat(32);
const tagB = 'b'.repeat(32);
const root = '/Obsidian/Personal';
const settings = {
  ...loadPluginData(null).settings,
  login: 'user',
  password: 'secret',
  folder: 'Obsidian/Personal',
};

function fixture() {
  let content = 'original';
  let tag: string | undefined = tagA;
  let listedTag: string | undefined = tagA;
  let putTag: string | undefined;
  let failWrite = false;
  let listingStatus = 207;
  const requests: HttpRequest[] = [];
  const cache = emptyRemoteCache(scopeFor(settings));
  const xml = () => `<d:multistatus xmlns:d="DAV:">
    <d:response><d:href>${root}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
    <d:response><d:href>${root}/note.md</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>${new TextEncoder().encode(content).length}</d:getcontentlength>${listedTag === undefined ? '' : `<d:getetag>${listedTag}</d:getetag>`}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
  </d:multistatus>`;
  const http = async (request: HttpRequest) => {
    requests.push(request);
    if (request.method === 'PROPFIND') return response(listingStatus, xml());
    if (request.method === 'GET') return response(200, content, tag ? { ETag: tag } : {});
    if (request.method === 'MKCOL') return response(405);
    if (request.method === 'PUT') {
      if (failWrite) throw new Error('Connection reset');
      return response(204, '', putTag ? { ETag: putTag } : {});
    }
    throw new Error(`Unexpected ${request.method}`);
  };
  const store = (saved = cache, connection = settings) =>
    new WebDavStore(connection, http, () => true, undefined, { timing: clock() }, saved);
  return {
    cache,
    requests,
    failWrite: () => {
      failWrite = true;
    },
    denyListing: () => {
      listingStatus = 403;
    },
    store,
    set: (next: string, revision: string | undefined) => {
      content = next;
      tag = revision;
      listedTag = revision;
    },
    listing: (revision: string | undefined) => {
      listedTag = revision;
    },
    putEtag: (revision: string | undefined) => {
      putTag = revision;
    },
    reads: () => requests.filter(({ method }) => method === 'GET').length,
  };
}

async function localFile(content: string): Promise<SyncStore> {
  const value = await snapshot(new TextEncoder().encode(content).buffer);
  return {
    list: async () => [{ path: 'note.md', size: value.data.byteLength }],
    read: async () => value,
    write: async () => {
      throw new Error('Unexpected local write');
    },
  };
}

test('a persisted cache avoids GET requests on a repeated unchanged preview', async () => {
  const f = fixture();
  const local = await localFile('original');
  const state: SyncState = { version: 1, scope: scopeFor(settings), hashes: {} };
  const first = await planSync(local, f.store(), state);
  assert.equal(first.entries[0]?.action, 'unchanged');
  assert.equal(f.reads(), 1);
  const saved = loadPluginData({ remoteCache: JSON.parse(JSON.stringify(f.cache)) }).remoteCache;
  const second = await planSync(local, f.store(saved), state);
  assert.equal(second.entries[0]?.action, 'unchanged');
  assert.equal(f.reads(), 1);
  assert.match(saved.files['note.md']?.hash ?? '', /^[a-f0-9]{64}$/u);
  assert.notEqual(saved.files['note.md']?.hash, tagA);
  assert.deepEqual(state.hashes, {});
});

test('a changed ETag with the same byte count triggers a fresh GET and a download plan', async () => {
  const f = fixture();
  const local = await localFile('original');
  const value = await local.read('note.md');
  assert.ok(value);
  const state: SyncState = {
    version: 1,
    scope: scopeFor(settings),
    hashes: { 'note.md': value.hash },
  };
  await planSync(local, f.store(), state);
  f.set('modified', tagB);
  const plan = await planSync(local, f.store(), state);
  assert.equal(plan.entries[0]?.action, 'download');
  assert.equal(f.reads(), 2);
});

test('missing, weak or malformed tags fall back to reading file bytes', async () => {
  for (const revision of [undefined, 'W/"weak"', 'bad-tag', '"bad\r\nheader"']) {
    const f = fixture();
    f.set('original', revision);
    // Malformed header values are tested through read(), not an invalid XML document.
    if (revision?.includes('\r')) f.listing(undefined);
    const first = f.store();
    await first.list();
    await first.inspect('note.md');
    const second = f.store();
    await second.list();
    await second.inspect('note.md');
    assert.equal(f.reads(), 2);
    assert.equal(Object.keys(f.cache.files).length, 0);
  }
});

test('cache entries are paired with the GET revision, never an older listing revision', async () => {
  const f = fixture();
  f.set('modified', tagB);
  f.listing(tagA);
  const store = f.store();
  await store.list();
  const fresh = await store.inspect('note.md');
  assert.ok(fresh);
  assert.equal(f.cache.files['note.md']?.etag, `"${tagB}"`);
  f.set('original', tagA);
  const next = f.store();
  await next.list();
  const reverted = await next.inspect('note.md');
  assert.notEqual(reverted?.hash, fresh.hash);
  assert.equal(f.reads(), 2);
});

test('a cache from a different account or folder is never reused', async () => {
  const f = fixture();
  const first = f.store();
  await first.list();
  await first.inspect('note.md');
  const other = f.store(f.cache, { ...settings, login: 'other' });
  await other.list();
  await other.inspect('note.md');
  assert.equal(f.reads(), 2);
});

test('confirmation rereads a cached upload destination and preserves a newer cloud edit', async () => {
  const f = fixture();
  const first = f.store();
  await first.list();
  const baseline = await first.read('note.md');
  assert.ok(baseline);
  const local = await localFile('local edit');
  const state: SyncState = {
    version: 1,
    scope: scopeFor(settings),
    hashes: { 'note.md': baseline.hash },
  };
  const remote = f.store();
  const plan = await planSync(local, remote, state);
  assert.equal(plan.entries[0]?.action, 'upload');
  assert.equal(f.reads(), 1);
  f.set('new cloud edit', tagB);
  const result = await executePlan(local, remote, state, plan, async () => {});
  assert.equal(result.uploaded, 0);
  assert.equal(result.errors.length, 1);
  assert.equal(
    f.requests.some(({ method }) => method === 'PUT'),
    false,
  );
});

test('writes without a returned ETag invalidate the old cache instead of guessing a new revision', async () => {
  const f = fixture();
  const remote = f.store();
  await remote.list();
  const before = await remote.read('note.md');
  assert.ok(before);
  await remote.write('note.md', new TextEncoder().encode('modified').buffer, before);
  assert.equal(f.cache.files['note.md'], undefined);
  f.set('modified', tagB);
  const next = f.store();
  await next.list();
  await next.inspect('note.md');
  assert.equal(f.reads(), 2);
  const put = f.requests.find(({ method }) => method === 'PUT');
  assert.equal(put?.headers['If-Match'], `"${tagA}"`);
});

test('a successful PUT with an ETag caches that revision with the sent bytes', async () => {
  const f = fixture();
  f.putEtag(tagB);
  const remote = f.store();
  await remote.list();
  const before = await remote.read('note.md');
  assert.ok(before);
  await remote.write('note.md', new TextEncoder().encode('modified').buffer, before);
  f.set('modified', tagB);
  const next = f.store();
  await next.list();
  const version = await next.inspect('note.md');
  assert.equal(f.reads(), 1);
  assert.equal(version?.hash, f.cache.files['note.md']?.hash);
});

test('a local edit is detected even when the cloud version is served from cache', async () => {
  const f = fixture();
  const remote = f.store();
  await remote.list();
  const before = await remote.read('note.md');
  assert.ok(before);
  const state: SyncState = {
    version: 1,
    scope: scopeFor(settings),
    hashes: { 'note.md': before.hash },
  };
  const plan = await planSync(await localFile('local edit'), f.store(), state);
  assert.equal(plan.entries[0]?.action, 'upload');
  assert.equal(f.reads(), 1);
});

test('a missing listing tag discards a previously populated entry and forces a read', async () => {
  const f = fixture();
  const first = f.store();
  await first.list();
  await first.inspect('note.md');
  assert.ok(f.cache.files['note.md']);
  f.listing(undefined);
  const next = f.store();
  await next.list();
  assert.equal(f.cache.files['note.md'], undefined);
  await next.inspect('note.md');
  assert.equal(f.reads(), 2);
});

test('a size mismatch forces a read even if the server repeats its old tag', async () => {
  const f = fixture();
  const first = f.store();
  await first.list();
  const old = await first.inspect('note.md');
  f.set('longer content', tagA);
  const next = f.store();
  await next.list();
  const changed = await next.inspect('note.md');
  assert.equal(f.reads(), 2);
  assert.notEqual(changed?.hash, old?.hash);
});

test('uncertain write outcomes discard cached versions before the next preview', async () => {
  const f = fixture();
  const remote = f.store();
  await remote.list();
  const before = await remote.read('note.md');
  assert.ok(before);
  f.failWrite();
  await assert.rejects(
    remote.write('note.md', new TextEncoder().encode('new').buffer, before),
    /network error/,
  );
  assert.equal(f.cache.files['note.md'], undefined);
  const next = f.store();
  await next.list();
  await next.inspect('note.md');
  assert.equal(f.reads(), 2);
});

test('failed listings cannot authorize cache hits or purge verified versions', async () => {
  const f = fixture();
  const remote = f.store();
  await remote.list();
  const before = await remote.inspect('note.md');
  assert.ok(before);
  f.denyListing();
  await assert.rejects(remote.list(), /403/);
  assert.equal(f.cache.files['note.md']?.hash, before.hash);
  await remote.inspect('note.md');
  assert.equal(f.reads(), 2);
});

test('folder scopes isolate otherwise matching cache entries', async () => {
  const f = fixture();
  const first = f.store();
  await first.list();
  await first.inspect('note.md');
  f.cache.scope = scopeFor({ ...settings, folder: 'Other' });
  const other = f.store();
  await other.list();
  await other.inspect('note.md');
  assert.equal(f.reads(), 2);
});
