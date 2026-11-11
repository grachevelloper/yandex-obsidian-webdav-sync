import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { build } from 'esbuild';
import { createDom } from '../helpers/dom';
import { snapshot } from '../../src/sync/snapshot';
import { SyncLog } from '../../src/logging/log';
import type { PlanEntry, SyncPlan } from '../../src/sync/types';

async function loadModule(file: string) {
  const bundle = await build({
    stdin: {
      contents:
        'export * from ' +
        JSON.stringify(path.resolve(file)) +
        '; export { setLanguage } from ' +
        JSON.stringify(path.resolve('src/i18n/index.ts')) +
        ';',
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    alias: { obsidian: path.resolve('tests/helpers/obsidian-host.mjs') },
  });
  const output = bundle.outputFiles[0];
  assert.ok(output);
  return import('data:text/javascript;base64,' + Buffer.from(output.contents).toString('base64'));
}

const { SyncModeMenu, setLanguage: setMenuLanguage } = await loadModule('src/ui/sync-mode-menu.ts');
const { SyncWindow, setLanguage: setWindowLanguage } = await loadModule('src/ui/sync-window.ts');
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const result = [...container.querySelectorAll('button')].find(
    (element) => element.textContent === text,
  );
  assert.ok(result, text);
  return result;
}

async function fixture(
  path = 'note.md',
  bytes = false,
  action: PlanEntry['action'] = 'conflict',
  side: 'both' | 'local' | 'remote' = 'both',
  desktop = false,
) {
  const dom = createDom();
  if (desktop)
    Object.defineProperty(dom.window, 'matchMedia', { value: () => ({ matches: true }) });
  const local = await snapshot(
    bytes ? new Uint8Array([0, 255]).buffer : new TextEncoder().encode('# Trip\n09:00').buffer,
  );
  const remote = await snapshot(
    bytes ? new Uint8Array([1, 254]).buffer : new TextEncoder().encode('# Trip\n10:00').buffer,
  );
  const plan: SyncPlan = {
    scope: 'test',
    mode: 'two-way',
    entries: [
      {
        path,
        action,
        localHash: side === 'remote' ? undefined : local.hash,
        remoteHash: side === 'local' ? undefined : remote.hash,
      },
    ],
  };
  const first = plan.entries[0];
  if (desktop && first) plan.entries.push({ ...first, path: 'second.md' });
  const window = new SyncWindow(
    { document: dom.window.document },
    new SyncLog().data,
    'local-log.json',
  );
  window.setFileLoader(async () => ({
    local: side === 'remote' ? undefined : local,
    remote: side === 'local' ? undefined : remote,
  }));
  window.show();
  const decision = window.confirm(plan, new AbortController().signal);
  return { window, plan, decision, dom };
}

test('reviews files beside the desktop list and protects an unsaved edit when switching', async () => {
  const { window, plan, decision, dom } = await fixture(
    'first.md',
    false,
    'download',
    'both',
    true,
  );
  const document = dom.window.document;
  try {
    const list = document.querySelector<HTMLElement>('.yds-preview-list');
    assert.ok(list);
    list.scrollTop = 50;
    const detail = document.querySelector<HTMLElement>('.yds-preview-detail');
    assert.ok(detail);
    button(list, 'first.md').click();
    await flush();
    assert.equal(window.title, 'Sync preview');
    const editor = detail.querySelector('textarea');
    assert.ok(editor);
    editor.value = 'Unsaved edit';
    editor.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

    button(list, 'second.md').click();
    button(window.contentEl, 'Confirm sync').click();
    assert.equal(detail.querySelector('textarea')?.value, 'Unsaved edit');
    assert.match(detail.textContent ?? '', /Save your choice or close the file/);

    button(detail, 'Apply to preview').click();
    assert.deepEqual(plan.entries[0]?.resolution, { kind: 'text', text: 'Unsaved edit' });
    const refreshed = document.querySelector<HTMLElement>('.yds-preview-list');
    assert.ok(refreshed);
    assert.equal(refreshed.scrollTop, 50);
    assert.equal(button(refreshed, 'first.md').getAttribute('aria-current'), 'true');
    button(refreshed, 'second.md').click();
    await flush();
    assert.equal(button(refreshed, 'second.md').getAttribute('aria-current'), 'true');
    assert.match(document.querySelector('.yds-preview-detail')?.textContent ?? '', /second.md/);

    button(window.contentEl, 'Confirm sync').click();
    assert.equal(await decision, true);
  } finally {
    window.close();
  }
});

test('the start menu returns a mode only after a deliberate choice and closes safely on cancellation', async () => {
  for (const mode of ['two-way', 'device-wins', 'cloud-wins']) {
    const dom = createDom();
    const menu = new SyncModeMenu({ document: dom.window.document });
    const decision = menu.choose(new AbortController().signal);
    assert.equal(menu.contentEl.querySelectorAll('[data-sync-mode]').length, 3);
    menu.contentEl.querySelector('[data-sync-mode="' + mode + '"]').click();
    assert.equal(await decision, mode);
    assert.equal(menu.isOpen, false);
  }
  const menu = new SyncModeMenu({ document: createDom().window.document });
  const controller = new AbortController();
  const decision = menu.choose(controller.signal);
  controller.abort();
  assert.equal(await decision, undefined);
});

test('conflicts must be resolved in the editor before the final preview can be confirmed', async () => {
  const { window, plan, decision, dom } = await fixture();
  try {
    assert.equal(button(window.contentEl, 'Confirm sync').disabled, true);
    button(window.contentEl, 'Resolve conflicts (1)').click();
    await flush();
    assert.equal(window.title, 'Resolve conflicts');
    assert.equal(window.contentEl.querySelector('select'), null);
    button(window.contentEl, 'Use both').click();
    const editor = window.contentEl.querySelector('textarea');
    assert.ok(editor);
    assert.match(editor.value, /09:00/);
    assert.match(editor.value, /10:00/);
    editor.value = '# Edited together';
    editor.dispatchEvent(new dom.window.Event('input'));
    button(window.contentEl, 'Mark resolved').click();
    button(window.contentEl, 'Review & save…').click();
    assert.equal(window.title, 'Sync preview');
    button(window.contentEl, 'Confirm sync').click();
    assert.equal(await decision, true);
    assert.deepEqual(plan.entries[0]?.resolution, { kind: 'text', text: '# Edited together' });
  } finally {
    window.close();
  }
});

test('manual drafts require confirmation before Use both replaces them', async () => {
  const { window, decision, dom } = await fixture();
  try {
    button(window.contentEl, 'Resolve conflicts (1)').click();
    await flush();
    const editor = window.contentEl.querySelector('textarea');
    assert.ok(editor);
    editor.value = 'My edit';
    editor.dispatchEvent(new dom.window.Event('input'));
    button(window.contentEl, 'Use both').click();
    assert.equal(window.contentEl.querySelector('textarea')?.value, 'My edit');
    button(window.contentEl, 'Keep editing').click();
    assert.equal(window.contentEl.querySelector('textarea')?.value, 'My edit');
  } finally {
    window.close();
  }
  assert.equal(await decision, false);
});

test('binary conflicts offer a version choice without pretending to edit attachment bytes', async () => {
  const { window, plan, decision } = await fixture('photo.png', true);
  try {
    button(window.contentEl, 'Resolve conflicts (1)').click();
    await flush();
    assert.equal(window.contentEl.querySelector('textarea'), null);
    assert.equal(window.contentEl.querySelectorAll('img').length, 2);
    assert.ok(window.contentEl.querySelector('img')?.src.startsWith('blob:'));
    assert.equal(
      [...window.contentEl.querySelectorAll('button')].some(
        (element) => element.textContent === 'Use both',
      ),
      false,
    );
    button(window.contentEl, 'Use Disk').click();
    button(window.contentEl, 'Mark resolved').click();
    button(window.contentEl, 'Review & save…').click();
    button(window.contentEl, 'Confirm sync').click();
    assert.equal(await decision, true);
    assert.deepEqual(plan.entries[0]?.resolution, { kind: 'remote' });
  } finally {
    window.close();
  }
});

test('incoming files open from the preview and edits are only staged after Apply to preview', async () => {
  const { window, plan, decision, dom } = await fixture('incoming.md', false, 'download', 'remote');
  try {
    button(window.contentEl, 'incoming.md').click();
    await flush();
    assert.equal(window.title, 'Review file');
    const editor = window.contentEl.querySelector('textarea');
    assert.ok(editor);
    assert.match(editor.value, /10:00/);
    editor.value = '# Reviewed incoming note';
    editor.dispatchEvent(new dom.window.Event('input'));
    assert.equal(plan.entries[0]?.resolution, undefined);
    button(window.contentEl, 'Apply to preview').click();
    assert.equal(window.title, 'Sync preview');
    assert.deepEqual(plan.entries[0]?.resolution, {
      kind: 'text',
      text: '# Reviewed incoming note',
    });
    button(window.contentEl, 'Confirm sync').click();
    assert.equal(await decision, true);
  } finally {
    window.close();
  }
});

test('an outgoing file can be skipped and a cancelled edit does not change the preview decision', async () => {
  const { window, plan, decision, dom } = await fixture('outgoing.md', false, 'upload', 'local');
  try {
    button(window.contentEl, 'outgoing.md').click();
    await flush();
    const editor = window.contentEl.querySelector('textarea');
    assert.ok(editor);
    editor.value = '# Draft not applied';
    editor.dispatchEvent(new dom.window.Event('input'));
    button(window.contentEl, 'Back to preview').click();
    assert.equal(plan.entries[0]?.resolution, undefined);
    button(window.contentEl, 'outgoing.md').click();
    await flush();
    button(window.contentEl, 'Skip file').click();
    assert.deepEqual(plan.entries[0]?.resolution, { kind: 'skip' });
    assert.match(window.contentEl.textContent, /0 changes/);
    button(window.contentEl, 'Finish check').click();
    assert.equal(await decision, true);
  } finally {
    window.close();
  }
});

test('mirror files can be reviewed on both sides or skipped with a non-exact-copy warning', async () => {
  const { window, plan, decision } = await fixture('incoming.md', false, 'download', 'remote');
  window.close();
  await decision;
  plan.mode = 'cloud-wins';
  const approved = window.confirm(plan, new AbortController().signal);
  try {
    button(window.contentEl, 'incoming.md').click();
    await flush();
    assert.ok(window.contentEl.querySelector('textarea'));
    assert.equal(
      [...window.contentEl.querySelectorAll('button')].some(
        (item) => item.textContent === 'Use Disk',
      ),
      true,
    );
    button(window.contentEl, 'Skip file').click();
    assert.match(window.contentEl.textContent, /will not be an exact copy/);
    button(window.contentEl, 'Finish check').click();
    assert.equal(await approved, true);
  } finally {
    window.close();
  }
});

test('an incoming file defaults to the proposed Disk version even when an older local file exists', async () => {
  const { window, decision } = await fixture('note.md', false, 'download');
  try {
    button(window.contentEl, 'note.md').click();
    await flush();
    assert.match(window.contentEl.querySelector('textarea')?.value ?? '', /10:00/);
    assert.doesNotMatch(window.contentEl.querySelector('textarea')?.value ?? '', /09:00/);
  } finally {
    window.close();
  }
  assert.equal(await decision, false);
});

test('Skip remaining downloads excludes incoming files for this run without deleting them', async () => {
  const { window, plan, decision } = await fixture('incoming.md', false, 'download', 'remote');
  try {
    button(window.contentEl, 'Skip remaining downloads').click();
    assert.deepEqual(plan.entries[0]?.resolution, { kind: 'skip' });
    assert.match(window.contentEl.textContent, /0 changes/);
    button(window.contentEl, 'Finish check').click();
    assert.equal(await decision, true);
  } finally {
    window.close();
  }
});

test('Russian mode menu and file editor use translated controls with unchanged mode IDs', async () => {
  setMenuLanguage('ru');
  const menu = new SyncModeMenu({ document: createDom().window.document });
  const choice = menu.choose(new AbortController().signal);
  try {
    assert.equal(menu.title, 'Начать синхронизацию');
    assert.match(menu.contentEl.textContent, /Двусторонняя синхронизация/);
    menu.contentEl.querySelector('[data-sync-mode="two-way"]').click();
    assert.equal(await choice, 'two-way');
  } finally {
    menu.close();
    setMenuLanguage('en');
  }

  setWindowLanguage('ru');
  const { window, decision } = await fixture();
  try {
    assert.equal(window.title, 'Проверка изменений');
    button(window.contentEl, 'note.md').click();
    await flush();
    assert.equal(window.title, 'Просмотр файла');
    assert.ok(button(window.contentEl, 'Взять обе версии'));
    assert.ok(button(window.contentEl, 'Сохранить выбор'));
    assert.doesNotMatch(window.contentEl.textContent, /Use both|Apply to preview|Reading current/);
  } finally {
    window.close();
    setWindowLanguage('en');
  }
  assert.equal(await decision, false);
});

test('choosing a disputed section retains the already combined edits', async () => {
  const { window, plan, dom } = await fixture();
  try {
    const entry = plan.entries[0];
    assert.ok(entry);
    entry.merge = [
      { text: '# New title\n\n' },
      { local: '09:00\n', remote: '10:00\n', base: '08:00\n' },
      { text: '\nDisk introduction\n' },
    ];
    button(window.contentEl, 'note.md').click();
    await flush();
    assert.equal(button(window.contentEl, 'Apply to preview').disabled, true);
    button(window.contentEl, 'Use Disk').click();
    const result = window.contentEl.querySelector('textarea');
    assert.ok(result);
    assert.equal(result.value, '# New title\n\n10:00\n\nDisk introduction\n');
    button(window.contentEl, 'Apply to preview').click();
    assert.deepEqual(entry.resolution, { kind: 'text', text: result.value });
    assert.ok(dom.window.document.querySelector('.yds-preview-table'));
  } finally {
    window.close();
  }
});

test('shows the destination after the user changes a proposed download to the device version', async () => {
  const { window, plan } = await fixture('incoming.md', false, 'download');
  try {
    button(window.contentEl, 'incoming.md').click();
    await flush();
    button(window.contentEl, 'Use local').click();
    button(window.contentEl, 'Apply to preview').click();
    assert.deepEqual(plan.entries[0]?.resolution, { kind: 'local' });
    assert.match(window.contentEl.textContent, /Update on Disk/);
  } finally {
    window.close();
  }
});

test('editing the title stages a rename and rejects a duplicate name before confirmation', async () => {
  const { window, plan, dom } = await fixture('incoming.md', false, 'download', 'remote');
  const entry = plan.entries[0];
  assert.ok(entry);
  plan.entries.push({
    path: 'existing.md',
    action: 'unchanged',
    localHash: 'same',
    remoteHash: 'same',
  });
  try {
    button(window.contentEl, 'incoming.md').click();
    await flush();
    button(window.contentEl, 'incoming.md').click();
    const input = dom.window.document.querySelector<HTMLInputElement>('.yds-filename-field input');
    assert.ok(input);
    assert.equal(input.value, 'incoming');
    assert.equal(input.selectionEnd, 'incoming'.length);

    input.value = 'existing';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.equal(button(window.contentEl, 'Apply to preview').disabled, true);
    assert.match(window.contentEl.textContent, /already in use/);
    input.value = 'new name';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal(entry.renameTo, undefined);
    button(window.contentEl, 'Apply to preview').click();
    assert.equal(entry.renameTo, 'new name.md');
    assert.match(window.contentEl.textContent, /New path: new name.md/);
  } finally {
    window.close();
  }
});

test('deletion from the file editor is visible in the preview and can be undone by skipping', async () => {
  const { window, plan, decision } = await fixture('incoming.md', false, 'download', 'remote');
  button(window.contentEl, 'incoming.md').click();
  await flush();
  button(window.contentEl, 'Stage deletion from both sides').click();
  assert.deepEqual(plan.entries[0]?.resolution, { kind: 'delete' });
  assert.match(window.contentEl.textContent, /Files marked for deletion from both sides: 1/);

  button(window.contentEl, 'incoming.md').click();
  await flush();
  button(window.contentEl, 'Skip file').click();
  assert.deepEqual(plan.entries[0]?.resolution, { kind: 'skip' });
  assert.doesNotMatch(window.contentEl.textContent, /Files marked for deletion from both sides/);
  window.close();
  assert.equal(await decision, false);
});
