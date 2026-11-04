import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runConcurrent, PathQueue } from '../../src/sync/concurrency';

test('bounds active work and waits for started tasks before rejecting a fatal failure', async () => {
  let active = 0;
  let peak = 0;
  const started: number[] = [];
  const finished: number[] = [];
  await assert.rejects(
    runConcurrent([0, 1, 2, 3], 2, async (value) => {
      started.push(value);
      peak = Math.max(peak, ++active);
      try {
        await Promise.resolve();
        if (value === 0) throw new Error('Fatal checkpoint failure');
        await new Promise<void>((resolve) => setImmediate(resolve));
      } finally {
        active--;
        finished.push(value);
      }
    }),
    /Fatal checkpoint failure/,
  );
  assert.equal(peak, 2);
  assert.deepEqual(started, [0, 1]);
  assert.equal(finished.length, 2);
  assert.equal(active, 0);
});

test('serializes tasks sharing an original or conflict path without blocking independent files', async () => {
  const queue = new PathQueue();
  const order: string[] = [];
  let release = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = queue.run(['note.md', 'copy.md'], async () => {
    order.push('original');
    await blocked;
  });
  const copy = queue.run(['copy.md'], async () => {
    order.push('copy');
  });
  const other = queue.run(['other.md'], async () => {
    order.push('other');
  });
  await other;
  assert.deepEqual(order, ['original', 'other']);
  release();
  await Promise.all([original, copy]);
  assert.deepEqual(order, ['original', 'other', 'copy']);
});

test('a persistence failure finishing after cancellation remains the reported failure', async () => {
  const { SyncCancelled } = await import('../../src/sync/errors');
  await assert.rejects(
    runConcurrent([0, 1], 2, async (value) => {
      if (value === 0) throw new SyncCancelled();
      await new Promise<void>((resolve) => setImmediate(resolve));
      throw new Error('Disk full');
    }),
    /Disk full/,
  );
});
