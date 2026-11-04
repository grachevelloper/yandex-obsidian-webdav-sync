import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
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
    alias: { obsidian: path.resolve('tests/ui/obsidian-host.mjs') },
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
) {
  const dom = new JSDOM();
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

test('the start menu returns a mode only after a deliberate choice and closes safely on cancellation', async () => {
  for (const mode of ['two-way', 'device-wins', 'cloud-wins']) {
    const dom = new JSDOM();
    const menu = new SyncModeMenu({ document: dom.window.document });
    const decision = menu.choose(new AbortController().signal);
    assert.equal(menu.contentEl.querySelectorAll('[data-sync-mode]').length, 3);
    menu.contentEl.querySelector('[data-sync-mode="' + mode + '"]').click();
    assert.equal(await decision, mode);
    assert.equal(menu.isOpen, false);
  }
  const menu = new SyncModeMenu({ document: new JSDOM().window.document });
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
  const menu = new SyncModeMenu({ document: new JSDOM().window.document });
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
    assert.equal(window.title, 'Предпросмотр синхронизации');
    button(window.contentEl, 'note.md').click();
    await flush();
    assert.equal(window.title, 'Просмотр файла');
    assert.ok(button(window.contentEl, 'Взять обе версии'));
    assert.ok(button(window.contentEl, 'Применить к плану'));
    assert.doesNotMatch(window.contentEl.textContent, /Use both|Apply to preview|Reading current/);
  } finally {
    window.close();
    setWindowLanguage('en');
  }
  assert.equal(await decision, false);
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
