import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebDavClient } from '../../src/webdav/client';
import { response } from './fixtures';

const connection = { login: 'user', password: 'secret', folder: 'Obsidian' };

test('stopping interrupts a cooldown immediately and never starts the retry', async () => {
  const controller = new AbortController();
  let sleeping = () => {};
  const waiting = new Promise<void>((resolve) => {
    sleeping = resolve;
  });
  let calls = 0;
  const client = new WebDavClient(
    connection,
    async () => {
      calls++;
      return response(429);
    },
    undefined,
    {
      signal: controller.signal,
      timing: {
        now: () => 0,
        sleep: () => {
          sleeping();
          return new Promise<void>(() => {});
        },
      },
    },
  );
  const pending = assert.rejects(client.request('GET', 'Obsidian/a.md'), /cancelled/i);
  await waiting;
  controller.abort();
  await pending;
  assert.equal(calls, 1);
});

test('stopping lets an in-flight write settle but cancels queued requests', async () => {
  const controller = new AbortController();
  let release = () => {};
  let started = () => {};
  const active = new Promise<void>((resolve) => {
    started = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const paths: string[] = [];
  const client = new WebDavClient(
    connection,
    async (request) => {
      paths.push(request.url);
      started();
      await blocked;
      return response(201);
    },
    undefined,
    { signal: controller.signal, concurrentRequests: 1 },
  );
  const first = client.request('PUT', 'Obsidian/a.md');
  const second = assert.rejects(client.request('PUT', 'Obsidian/b.md'), /cancelled/i);
  await active;
  controller.abort();
  release();
  assert.equal((await first).status, 201);
  await second;
  assert.equal(paths.length, 1);
});
