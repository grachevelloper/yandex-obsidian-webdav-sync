import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decideChange } from '../../src/sync/decisions';
import type { Snapshot } from '../../src/sync/types';

const file = (hash: string): Snapshot => ({ hash, data: new ArrayBuffer(0) });

test('selects an explicit action for each synchronization state', () => {
  for (const [local, remote, baseline, kind] of [
    [undefined, undefined, undefined, 'missing'],
    [file('a'), file('a'), undefined, 'unchanged'],
    [file('a'), undefined, 'a', 'upload'],
    [undefined, file('a'), 'a', 'download'],
    [file('a'), file('b'), 'b', 'upload'],
    [file('a'), file('b'), 'a', 'download'],
    [file('a'), file('b'), 'old', 'conflict'],
    [file('a'), file('b'), undefined, 'conflict'],
  ] as const) {
    assert.equal(decideChange(local, remote, baseline).kind, kind);
  }
});
