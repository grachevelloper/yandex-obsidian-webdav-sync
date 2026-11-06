import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDom } from './dom';
import { renderPreview } from '../../src/ui/render-preview';

test('explains direction, conflicts and restoration without exposing a delete action', () => {
  const dom = createDom('<main></main>');
  const container = dom.window.document.querySelector('main');
  assert.ok(container);
  renderPreview(container, {
    scope: 'test',
    entries: [
      { path: 'new.md', action: 'upload', localHash: 'local' },
      { path: 'restore.md', action: 'download', remoteHash: 'remote', baseline: 'remote' },
      {
        path: '<img>.md',
        action: 'conflict',
        localHash: 'a',
        remoteHash: 'b',
        copyPath: 'copy.md',
      },
      { path: 'same.md', action: 'unchanged', localHash: 'same', remoteHash: 'same' },
    ],
  });
  assert.match(container.textContent ?? '', /Upload/);
  assert.match(container.textContent ?? '', /↓ Restore/);
  assert.match(container.textContent ?? '', /copy.md/);
  assert.match(container.textContent ?? '', /No files will be deleted/);
  assert.match(container.textContent ?? '', /Restore/);
  assert.equal(container.querySelector('img'), null);
  assert.equal(container.querySelector('.yds-metrics'), null);
  assert.match(
    container.querySelector('.yds-preview-toolbar')?.textContent ?? '',
    /4 files total · 3 changes/,
  );
  assert.doesNotMatch(container.textContent ?? '', /GRACHEVELOPER|Review before syncing/);
});

test('blocks confirmation of incomplete previews and displays the failed path', () => {
  const dom = createDom('<main></main>');
  const container = dom.window.document.querySelector('main');
  assert.ok(container);
  const view = renderPreview(container, {
    scope: 'test',
    entries: [{ path: 'broken.md', action: 'error', message: 'HTTP 403' }],
  });
  assert.equal(view.canConfirm, false);
  assert.match(container.textContent ?? '', /broken.md/);
  assert.match(container.textContent ?? '', /HTTP 403/);
  assert.match(container.textContent ?? '', /Confirmation is disabled/);
});

test('groups files into collapsible folders with compact action columns', () => {
  const dom = createDom('<main></main>');
  const container = dom.window.document.querySelector('main');
  assert.ok(container);
  renderPreview(container, {
    scope: 'test',
    entries: [
      { path: 'Notes/Projects/a.md', action: 'upload', localHash: 'a' },
      { path: 'Notes/b.md', action: 'download', remoteHash: 'b' },
      { path: 'root.md', action: 'upload', localHash: 'c' },
    ],
  });
  assert.deepEqual(
    [...container.querySelectorAll('thead th')].map((cell) => cell.textContent),
    ['File', 'Action'],
  );
  const folders = container.querySelectorAll<HTMLButtonElement>('.yds-folder-toggle');
  assert.equal(folders.length, 2);
  assert.match(folders[0]?.textContent ?? '', /Notes/);
  assert.match(folders[1]?.textContent ?? '', /Projects/);
  folders[0]?.click();
  const visible = [...container.querySelectorAll<HTMLTableRowElement>('tbody tr')].filter(
    (row) => !row.hidden,
  );
  assert.equal(visible.length, 2);
  assert.match(visible[1]?.textContent ?? '', /root.md/);
  assert.equal(folders[0]?.getAttribute('aria-expanded'), 'false');
  folders[0]?.click();
  assert.equal(
    [...container.querySelectorAll<HTMLTableRowElement>('tbody tr')].filter((row) => !row.hidden)
      .length,
    5,
  );
});

test('hides unchanged files by default and lets the user include them without changing the plan', () => {
  const dom = createDom('<main></main>');
  const container = dom.window.document.querySelector('main');
  assert.ok(container);
  const entries = [
    { path: 'Notes/a.md', action: 'unchanged' as const, localHash: 'same', remoteHash: 'same' },
    { path: 'Notes/b.md', action: 'upload' as const, localHash: 'new' },
  ];
  const view = renderPreview(container, { scope: 'test', entries });
  assert.doesNotMatch(container.querySelector('tbody')?.textContent ?? '', /a.md/);
  const checkbox = container.querySelector<HTMLInputElement>('input[type=checkbox]');
  assert.ok(checkbox);
  checkbox.click();
  assert.match(container.querySelector('tbody')?.textContent ?? '', /a.md/);
  assert.equal(view.changes, 1);
  assert.equal(entries.length, 2);
});
