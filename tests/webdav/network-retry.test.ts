import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebDavClient } from '../../src/webdav/client';
import { SyncInterrupted } from '../../src/sync/errors';
import { SyncLog } from '../../src/logging/log';
import { response } from './fixtures';
import { clock } from './timing';

const connection = { login: 'user', password: 'secret', folder: 'Obsidian' };

test('retries interrupted GET and PROPFIND reads with bounded waits and progress', async () => {
  for (const method of ['GET', 'PROPFIND']) {
    const timing = clock();
    const log = new SyncLog();
    let calls = 0;
    const progress: string[] = [];
    const retries: string[] = [];
    const client = new WebDavClient(
      connection,
      async () => {
        if (++calls < 3) throw new Error('net::ERR_CONNECTION_RESET private credentials');
        return response(200);
      },
      log.record,
      {
        timing,
        onRequest: (_method, path) => {
          progress.push(path);
        },
        onRetry: (retry) => {
          retries.push(retry.reason);
        },
      },
    );

    assert.equal((await client.request(method, 'Obsidian/folder')).status, 200);
    assert.equal(calls, 3);
    assert.deepEqual(timing.delays, [5000, 10000]);
    assert.deepEqual(retries, ['network', 'network']);
    assert.deepEqual(progress, Array(3).fill('Obsidian/folder'));
    assert.equal(JSON.stringify(log.data).includes('private credentials'), false);
    assert.ok(log.data.events.some((event) => event.details?.code === 'ERR_CONNECTION_RESET'));
  }
});

test('stops the entire run after repeated read failures instead of scanning more files', async () => {
  const timing = clock();
  let calls = 0;
  const client = new WebDavClient(
    connection,
    async () => {
      calls++;
      throw Object.assign(new Error('private message'), { cause: { code: 'ETIMEDOUT' } });
    },
    undefined,
    { timing },
  );

  await assert.rejects(
    client.request('PROPFIND', 'Obsidian/folder'),
    (error) => error instanceof SyncInterrupted && error.message.includes('ETIMEDOUT'),
  );
  assert.equal(calls, 3);
  await assert.rejects(client.request('GET', 'Obsidian/another.md'), SyncInterrupted);
  assert.equal(calls, 3);
});

test('does not repeat writes with an uncertain network outcome', async () => {
  for (const method of ['PUT', 'MKCOL']) {
    const timing = clock();
    let calls = 0;
    const client = new WebDavClient(
      connection,
      async () => {
        calls++;
        throw new Error('net::ERR_TIMED_OUT secret');
      },
      undefined,
      { timing },
    );

    await assert.rejects(client.request(method, 'Obsidian/a.md'), /ERR_TIMED_OUT/);
    assert.equal(calls, 1);
    assert.deepEqual(timing.delays, []);
  }
});

test('records safe native error codes and durations without raw errors', async () => {
  for (const [error, code] of [
    [new Error('net::ERR_CONNECTION_RESET password=secret'), 'ERR_CONNECTION_RESET'],
    [{ cause: { code: 'ECONNRESET' }, message: 'secret' }, 'ECONNRESET'],
    [{ name: 'TimeoutError', message: 'secret' }, 'TIMEOUT'],
    [{ domain: 'NSURLErrorDomain', code: -1001 }, 'NSURLErrorTimedOut'],
    [
      new Error('The operation could not be completed. (NSURLErrorDomain error -1001.) secret'),
      'NSURLErrorTimedOut',
    ],
    [new Error('NSURLErrorDomain Code=-1005 private secret'), 'NSURLErrorNetworkConnectionLost'],
    [new Error('private secret Authorization'), 'NETWORK_ERROR'],
  ] as const) {
    const log = new SyncLog();
    const client = new WebDavClient(
      connection,
      async () => {
        throw error;
      },
      log.record,
      { timing: clock() },
    );

    await assert.rejects(
      client.request('PUT', 'Obsidian/a.md'),
      (error) => error instanceof Error && error.message.includes(code),
    );
    const failure = log.data.events.find(
      (event) => event.message === 'WebDAV network request failed',
    );
    assert.equal(failure?.details?.code, code);
    assert.ok(typeof failure?.details?.elapsedMs === 'number');
    assert.equal(JSON.stringify(log.data).includes('secret'), false);
    assert.equal(JSON.stringify(log.data).includes('Authorization'), false);
  }
});
