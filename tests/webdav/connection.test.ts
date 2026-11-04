import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkConnection } from '../../src/webdav/connection';
import type { HttpRequest } from '../../src/webdav/client';
import { listing, response } from './fixtures';
import { clock } from './timing';

const connection = { login: 'user', password: 'secret', folder: 'Obsidian/Personal' };

test('connection check reads only root and selected folder properties without listing children', async () => {
  const requests: HttpRequest[] = [];
  const result = await checkConnection(
    connection,
    async (request) => {
      requests.push(request);
      return response(207, listing(new URL(request.url).pathname, '<d:collection/>'));
    },
    { timing: clock() },
  );
  assert.equal(result.folderExists, true);
  assert.equal(requests.length, 2);
  assert.ok(
    requests.every((request) => request.method === 'PROPFIND' && request.headers.Depth === '0'),
  );
});

test('valid credentials with a missing folder are distinguished from authentication failure', async () => {
  const result = await checkConnection(
    connection,
    async (request) =>
      new URL(request.url).pathname === '/'
        ? response(207, listing('/', '<d:collection/>'))
        : response(404),
    { timing: clock() },
  );
  assert.equal(result.folderExists, false);
  for (const status of [401, 403]) {
    await assert.rejects(
      checkConnection(connection, async () => response(status), { timing: clock() }),
      /login|password|access/i,
    );
  }
});

test('connection check rejects malformed properties and a file in place of the folder', async () => {
  for (const body of ['not XML', listing('/', '')]) {
    await assert.rejects(
      checkConnection(connection, async () => response(207, body), { timing: clock() }),
    );
  }
});
