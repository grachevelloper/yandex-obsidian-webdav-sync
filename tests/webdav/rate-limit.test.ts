import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebDavClient } from '../../src/webdav/client';
import { SyncLog } from '../../src/logging/log';
import { response } from './fixtures';

import { clock } from './timing';

const connection = { login: 'user', password: 'secret', folder: 'Obsidian' };

test('spaces concurrent requests and never overlaps transport calls', async () => {
  const timing = clock();
  const starts: number[] = [];
  let active = 0;
  let peak = 0;
  const client = new WebDavClient(
    connection,
    async () => {
      starts.push(timing.now());
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      return response(200);
    },
    undefined,
    { timing, concurrentRequests: 1 },
  );

  const startedAt = timing.now();
  await Promise.all(
    ['a.md', 'b.md', 'c.md'].map((path) => client.request('GET', `Obsidian/${path}`)),
  );

  assert.equal(peak, 1);
  assert.deepEqual(
    starts.map((time) => time - startedAt),
    [0, 1000, 2000],
  );
});

test('retries 429 after the server cooldown and reports waiting without secrets', async () => {
  const timing = clock();
  const log = new SyncLog();
  const waits: number[] = [];
  let calls = 0;
  const client = new WebDavClient(
    connection,
    async () =>
      ++calls === 1 ? response(429, 'private body', { 'Retry-After': '12' }) : response(207),
    log.record,
    {
      timing,
      onRetry: (retry) => {
        waits.push(retry.delayMs);
      },
    },
  );

  assert.equal((await client.request('PROPFIND', 'Obsidian')).status, 207);
  assert.deepEqual(timing.delays, [12000]);
  assert.deepEqual(waits, [12000]);
  assert.ok(log.data.events.some((event) => event.details?.delayMs === 12000));
  assert.equal(JSON.stringify(log.data).includes('secret'), false);
  assert.equal(JSON.stringify(log.data).includes('private body'), false);
});

test('supports Retry-After dates and backs off when the header is absent or malformed', async () => {
  for (const [headers, expected] of [
    [{ 'retry-after': new Date(Date.UTC(2026, 9, 29) + 15000).toUTCString() }, 15000],
    [{}, 5000],
    [{ 'Retry-After': 'invalid' }, 5000],
    [{ 'Retry-After': '0' }, 5000],
  ] as const) {
    const timing = clock();
    let calls = 0;
    const client = new WebDavClient(
      connection,
      async () => (++calls === 1 ? response(429, '', headers) : response(200)),
      undefined,
      { timing },
    );
    await client.request('GET', 'Obsidian/a.md');
    assert.deepEqual(timing.delays, [expected]);
  }
});

test('stops the run after bounded exponential retries and sends no further requests', async () => {
  const timing = clock();
  let calls = 0;
  const client = new WebDavClient(
    connection,
    async () => {
      calls++;
      return response(429);
    },
    undefined,
    { timing },
  );

  await assert.rejects(client.request('GET', 'Obsidian/a.md'), /rate limit/i);
  assert.equal(calls, 4);
  assert.deepEqual(timing.delays, [5000, 10000, 20000]);
  await assert.rejects(client.request('GET', 'Obsidian/b.md'), /rate limit/i);
  assert.equal(calls, 4);
});

test('does not retry before a cooldown that exceeds the automatic wait budget', async () => {
  const timing = clock();
  let calls = 0;
  const client = new WebDavClient(
    connection,
    async () => {
      calls++;
      return response(429, '', { 'Retry-After': '120' });
    },
    undefined,
    { timing },
  );

  await assert.rejects(client.request('GET', 'Obsidian/a.md'), /120 seconds/);
  assert.equal(calls, 1);
  assert.deepEqual(timing.delays, []);
});

test('retries a conditional PUT with identical bytes and precondition', async () => {
  const timing = clock();
  const requests: { body?: string | ArrayBuffer; headers: Record<string, string> }[] = [];
  const data = new Uint8Array([0, 255, 128]).buffer;
  const client = new WebDavClient(
    connection,
    async (request) => {
      requests.push(request);
      return response(requests.length === 1 ? 429 : 204);
    },
    undefined,
    { timing },
  );
  assert.equal(
    (await client.request('PUT', 'Obsidian/a.png', { 'If-Match': '"revision"' }, data)).status,
    204,
  );
  assert.equal(requests.length, 2);
  assert.ok(
    requests.every(
      (request) => request.body === data && request.headers['If-Match'] === '"revision"',
    ),
  );
});

test('does not retry authentication errors, stale writes or uncertain network failures', async () => {
  for (const status of [401, 403, 412, 503]) {
    const timing = clock();
    let calls = 0;
    const client = new WebDavClient(
      connection,
      async () => {
        calls++;
        return response(status);
      },
      undefined,
      { timing },
    );
    assert.equal((await client.request('PUT', 'Obsidian/a.md')).status, status);
    assert.equal(calls, 1);
  }

  const timing = clock();
  let calls = 0;
  const client = new WebDavClient(
    connection,
    async () => {
      calls++;
      throw new Error('unknown write outcome');
    },
    undefined,
    { timing },
  );
  await assert.rejects(client.request('PUT', 'Obsidian/a.md'), /network error/);
  assert.equal(calls, 1);
});

test('allows two outstanding requests while independently pacing their starts', async () => {
  const timing = clock();
  const initialTime = timing.now();
  const starts: number[] = [];
  const releases: (() => void)[] = [];
  let active = 0;
  let peak = 0;
  const client = new WebDavClient(
    connection,
    async () => {
      starts.push(timing.now());
      peak = Math.max(peak, ++active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active--;
      return response(200);
    },
    undefined,
    { timing, concurrentRequests: 2, requestIntervalMs: 250 },
  );
  const running = Promise.all(
    ['a', 'b', 'c'].map((path) => client.request('GET', `Obsidian/${path}`)),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(starts.length, 2);
  assert.equal(peak, 2);
  assert.deepEqual(starts, [initialTime, initialTime + 250]);
  releases[0]?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(starts.length, 3);
  assert.deepEqual(starts, [initialTime, initialTime + 250, initialTime + 500]);
  releases[1]?.();
  releases[2]?.();
  await running;
  assert.equal(active, 0);
});

test('a 429 extends the shared cooldown even for a request already waiting to start', async () => {
  let now = 0;
  const sleepers: { at: number; resolve: () => void }[] = [];
  const timing = {
    now: () => now,
    sleep: (delay: number) =>
      new Promise<void>((resolve) => sleepers.push({ at: now + delay, resolve })),
  };
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
  const advance = async (milliseconds: number) => {
    now += milliseconds;
    for (const sleeper of sleepers.splice(0)) {
      if (sleeper.at <= now) sleeper.resolve();
      else sleepers.push(sleeper);
    }
    await flush();
  };
  let limited = (_response: ReturnType<typeof response>) => {};
  let finishOther = (_response: ReturnType<typeof response>) => {};
  const first = new Promise<ReturnType<typeof response>>((resolve) => {
    limited = resolve;
  });
  const other = new Promise<ReturnType<typeof response>>((resolve) => {
    finishOther = resolve;
  });
  let attempts = 0;
  const starts: [string, number][] = [];
  const client = new WebDavClient(
    connection,
    async (request) => {
      const path = request.url.split('/').at(-1) ?? '';
      starts.push([path, now]);
      if (path === 'a' && ++attempts === 1) return first;
      if (path === 'b') return other;
      return response(200);
    },
    undefined,
    { timing, concurrentRequests: 2, requestIntervalMs: 1000 },
  );
  const running = Promise.all(
    ['a', 'b', 'c'].map((path) => client.request('GET', `Obsidian/${path}`)),
  );
  await flush();
  limited(response(429, '', { 'Retry-After': '5' }));
  await flush();
  await advance(1000);
  assert.deepEqual(starts, [['a', 0]]);
  await advance(4000);
  await advance(1000);
  await advance(1000);
  finishOther(response(200));
  await running;
  assert.deepEqual(starts, [
    ['a', 0],
    ['b', 5000],
    ['a', 6000],
    ['c', 7000],
  ]);
});
