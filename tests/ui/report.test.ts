import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDom } from '../helpers/dom';
import { renderReport } from '../../src/ui/render-report';
import { SyncLog } from '../../src/logging/log';

test('renders metric cards, both conflict paths and a working log button', () => {
  const dom = createDom('<main></main>');
  const container = dom.window.document.querySelector('main');
  assert.ok(container);
  const log = new SyncLog();
  log.complete({
    uploaded: 2,
    downloaded: 3,
    conflicts: [{ path: 'note.md', copyPath: 'note.conflict-hash.md' }],
    skipped: [],
    errors: [],
  });
  let opened = false;
  renderReport(container, log.data, () => {
    opened = true;
  });

  assert.equal(container.querySelectorAll('.yds-stat').length, 5);
  assert.ok(container.textContent?.includes('note.md'));
  assert.ok(container.textContent?.includes('note.conflict-hash.md'));
  assert.ok(container.textContent?.includes('Cloud version'));
  assert.ok(container.textContent?.includes('Local version'));
  container.querySelector('button')?.click();
  assert.equal(opened, true);
});

test('renders untrusted paths and failures as text instead of HTML', () => {
  const dom = createDom('<main></main>');
  const container = dom.window.document.querySelector('main');
  assert.ok(container);
  const log = new SyncLog();
  log.fail('<img src=x onerror=alert(1)>');
  renderReport(container, log.data, () => {});
  assert.equal(container.querySelector('img'), null);
  assert.ok(container.textContent?.includes('<img src=x onerror=alert(1)>'));
  assert.ok(container.textContent?.includes('Sync stopped'));
});

test('states that files were skipped and restores a previous version as a copy', async () => {
  const dom = createDom('<main></main>');
  const container = dom.window.document.querySelector('main');
  assert.ok(container);
  const log = new SyncLog();
  log.record('info', 'Saved', { path: 'note.md', side: 'remote', recoveryHash: 'hash' });
  log.complete({
    uploaded: 1,
    downloaded: 1,
    merged: 1,
    conflicts: [],
    skipped: ['skip.md'],
    errors: [],
  });
  renderReport(
    container,
    log.data,
    () => {},
    undefined,
    async (path, hash) => {
      assert.equal(path, 'note.md');
      assert.equal(hash, 'hash');
      return 'note.recovered.md';
    },
  );

  assert.match(container.textContent ?? '', /Sync finished with skipped files/);
  assert.match(container.textContent ?? '', /Edits merged/);
  const restore = container.querySelector<HTMLButtonElement>('.yds-recovery-row button');
  assert.ok(restore);
  restore.click();
  await Promise.resolve();
  assert.match(container.textContent ?? '', /Copy saved on this device: note.recovered.md/);
});

test('uses a calm success state when there are no conflicts or errors', () => {
  const dom = createDom('<main></main>');
  const container = dom.window.document.querySelector('main');
  assert.ok(container);
  const log = new SyncLog();
  log.complete({ uploaded: 0, downloaded: 0, conflicts: [], skipped: [], errors: [] });
  renderReport(container, log.data, () => {});
  assert.ok(container.textContent?.includes('Everything is up to date'));
  assert.equal(container.querySelectorAll('details').length, 0);
});
