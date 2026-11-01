import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { SyncLog } from '../../src/logging/log';

const bundle = await build({
  entryPoints: [path.resolve('src/ui/sync-window.ts')],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  alias: { obsidian: path.resolve('tests/ui/obsidian-host.mjs') },
});
const output = bundle.outputFiles[0];
assert.ok(output);
const { SyncWindow } = await import(
  `data:text/javascript;base64,${Buffer.from(output.contents).toString('base64')}`
);

function setup() {
  const dom = new JSDOM();
  const log = new SyncLog();
  const window = new SyncWindow({ document: dom.window.document }, log.data, 'local-log.json');
  const button = (label: string) =>
    [...window.contentEl.querySelectorAll('button')].find(
      (element) => element.textContent === label,
    );
  return { window, log, button };
}

test('hiding and reopening progress preserves counters without opening duplicate windows', () => {
  const { window, button } = setup();
  try {
    window.show();
    window.update({ phase: 'preview', processed: 2, total: 5, activePaths: ['a.md', 'b.md'] });
    window.show();
    assert.equal(window.openCount, 1);
    button('Hide window')?.click();
    assert.equal(window.isOpen, false);
    window.show();
    assert.equal(window.openCount, 2);
    assert.match(window.contentEl.textContent, /2 \/ 5 files processed/);
    assert.equal(window.contentEl.querySelectorAll('.yds-active-file').length, 2);
  } finally {
    window.close();
  }
});

test('confirmation transitions to progress and then to the report in the same window', async () => {
  const { window, log, button } = setup();
  try {
    window.show();
    const decision = window.confirm(
      { scope: 'test', entries: [{ path: 'a.md', action: 'upload', localHash: 'hash' }] },
      new AbortController().signal,
    );
    assert.equal(window.title, 'Sync preview');
    button('Confirm sync')?.click();
    assert.equal(await decision, true);
    assert.equal(window.isOpen, true);
    assert.equal(window.openCount, 1);
    assert.equal(window.title, 'Syncing files');
    log.complete({ uploaded: 1, downloaded: 0, conflicts: [], errors: [], skipped: [] });
    window.update({ phase: 'sync', processed: 1, total: 1, activePaths: [] });
    window.finish();
    assert.equal(window.title, 'Sync report');
    assert.match(window.contentEl.textContent, /1 \/ 1 files processed/);
    assert.equal(window.openCount, 1);
  } finally {
    window.close();
  }
});

test('closing or aborting a confirmation cancels it, including after hiding progress', async () => {
  for (const abort of [false, true]) {
    const { window } = setup();
    const controller = new AbortController();
    try {
      window.show();
      window.close();
      const decision = window.confirm({ scope: 'test', entries: [] }, controller.signal);
      assert.match(window.contentEl.textContent, /No file changes/);
      if (abort) controller.abort();
      else window.close();
      assert.equal(await decision, false);
      assert.equal(window.isOpen, false);
    } finally {
      window.close();
    }
  }
});

test('displays retry countdowns in the window and clears them when a request starts', () => {
  const { window } = setup();
  try {
    window.show();
    window.waiting({ reason: 'rate-limit', delayMs: 5000, attempt: 1 });
    assert.match(window.contentEl.textContent, /Retrying in 5s/);
    window.requestStarted('GET', 'Notes/a.md');
    assert.doesNotMatch(window.contentEl.textContent, /Retrying/);
    assert.match(window.contentEl.textContent, /Reading file: Notes\/a.md/);
  } finally {
    window.close();
  }
});
