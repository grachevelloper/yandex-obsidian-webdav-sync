import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { build } from 'esbuild';
import { createDom } from '../helpers/dom';
import { SyncLog } from '../../src/logging/log';

const bundle = await build({
  entryPoints: [path.resolve('src/ui/sync-window.ts')],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  alias: { obsidian: path.resolve('tests/helpers/obsidian-host.mjs') },
});
const output = bundle.outputFiles[0];
assert.ok(output);
const { SyncWindow } = await import(
  `data:text/javascript;base64,${Buffer.from(output.contents).toString('base64')}`
);

function setup() {
  const dom = createDom();
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
    assert.equal(
      window.contentEl.ownerDocument.activeElement,
      window.contentEl.querySelector('[role=progressbar]'),
    );
    button('Hide window')?.focus();
    assert.equal(window.contentEl.ownerDocument.activeElement, button('Hide window'));
    button('Hide window')?.click();
    assert.equal(window.isOpen, false);
    window.show();
    assert.equal(window.openCount, 2);
    assert.equal(
      window.contentEl.ownerDocument.activeElement,
      window.contentEl.querySelector('[role=progressbar]'),
    );
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
    assert.equal(
      window.contentEl.ownerDocument.activeElement,
      window.contentEl.querySelector('[role=progressbar]'),
    );
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

test('stop remains visible after reopening progress and reports waiting for active requests', () => {
  const dom = createDom();
  let stopped = 0;
  const window = new SyncWindow(
    { document: dom.window.document },
    new SyncLog().data,
    'local-log.json',
    () => {
      stopped++;
    },
  );
  try {
    window.show();
    window.close();
    window.show();
    const stop = [...window.contentEl.querySelectorAll('button')].find(
      (button) => button.textContent === 'Stop sync',
    );
    assert.ok(stop);
    stop.click();
    stop.click();
    assert.equal(stopped, 1);
    assert.match(window.contentEl.textContent, /Stopping/);
    assert.match(window.contentEl.textContent, /in-flight/i);
  } finally {
    window.close();
  }
});

test('progress timers start and stop in the window that owns the modal', () => {
  const { window } = setup();
  const owner = window.contentEl.ownerDocument.defaultView;
  let started = 0;
  let cleared = 0;
  owner.setInterval = (callback: () => void, milliseconds: number) => {
    assert.equal(milliseconds, 1000);
    started++;
    callback();
    return 42;
  };
  owner.clearInterval = (timer: number) => {
    assert.equal(timer, 42);
    cleared++;
  };
  window.show();
  assert.equal(started, 1);
  window.close();
  assert.equal(cleared, 1);
});
