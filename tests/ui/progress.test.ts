import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDom } from './dom';
import { FileProgress } from '../../src/sync/progress';
import { renderProgress } from '../../src/ui/render-progress';
import type { SyncProgress } from '../../src/sync/progress';

test('counts completed files independently of concurrently active files', () => {
  const updates: SyncProgress[] = [];
  const progress = new FileProgress('preview', 3, (value) => updates.push(value));
  progress.start('a.md');
  progress.start('b.md');
  progress.finish('b.md');
  assert.deepEqual(updates.at(-1), {
    phase: 'preview',
    processed: 1,
    total: 3,
    activePaths: ['a.md'],
  });
  progress.start('c.md');
  progress.finish('a.md');
  progress.finish('c.md');
  assert.deepEqual(updates.at(-1), { phase: 'preview', processed: 3, total: 3, activePaths: [] });
  assert.equal(updates[1]?.processed, 0);
});

test('shows unknown totals honestly, parallel file names safely and an empty run as complete', () => {
  const dom = createDom('<main></main>');
  const container = dom.window.document.querySelector('main');
  assert.ok(container);
  const view = renderProgress(container);
  view.update({ phase: 'listing', processed: 0, activePaths: [] });
  assert.match(container.textContent ?? '', /Listing folders/);
  assert.equal(view.bar.hasAttribute('aria-valuenow'), false);
  view.update({ phase: 'sync', processed: 2, total: 5, activePaths: ['a.md', '<img src=x>.md'] });
  assert.match(container.textContent ?? '', /2 \/ 5 files processed/);
  assert.equal(container.querySelectorAll('.yds-active-file').length, 2);
  assert.equal(container.querySelector('img'), null);
  assert.equal(view.percent(), 40);
  view.update({ phase: 'sync', processed: 0, total: 0, activePaths: [] });
  assert.equal(view.percent(), 100);
  assert.doesNotMatch(container.textContent ?? '', /GRACHEVELOPER/);
});

test('progress adopts Obsidian helper fragments into the container document', () => {
  const dom = createDom('<main></main>');
  const container = dom.window.document.querySelector('main');
  assert.ok(container);
  const otherWindow = createDom();
  const fragment = otherWindow.window.document.createDocumentFragment();
  otherWindow.window.createFragment = () => fragment;

  renderProgress(container);
  assert.equal(fragment.ownerDocument, dom.window.document);
  assert.equal(container.querySelector('.yds-progress-bar')?.ownerDocument, dom.window.document);
});
