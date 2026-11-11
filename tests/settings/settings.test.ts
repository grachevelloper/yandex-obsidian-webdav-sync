import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import type { SettingDefinition } from 'obsidian';
import { build } from 'esbuild';
import type WebDavSync from '../../src/main';
import { createDom } from '../helpers/dom';
import { loadPluginData, scopeFor, validateSettings } from '../../src/settings/data';

test('loads defaults without sharing the state map', () => {
  const first = loadPluginData(null);
  const second = loadPluginData(null);
  first.state.hashes['a.md'] = 'a'.repeat(64);
  assert.deepEqual(Object.keys(second.state.hashes), []);
  assert.equal(first.settings.folder, 'Obsidian/Personal');
  assert.equal(first.settings.concurrentRequests, 8);
});

test('restores saved hashes and credentials while rejecting damaged state', () => {
  const data = loadPluginData(null);
  data.settings.login = 'user';
  data.settings.password = 'app password';
  data.state.hashes['a.md'] = 'a'.repeat(64);
  assert.equal(
    loadPluginData(JSON.parse(JSON.stringify(data))).state.hashes['a.md'],
    'a'.repeat(64),
  );

  for (const state of [{ version: 2 }, { version: 1, scope: '', hashes: { 'a.md': 'invalid' } }]) {
    assert.throws(() => loadPluginData({ state }));
  }
});

test('binds the baseline to the account and folder, independent of password rotation', () => {
  const settings = {
    ...loadPluginData(null).settings,
    login: ' user ',
    password: 'old',
    folder: '/Obsidian/Personal/',
  };
  const scope = scopeFor(settings);
  assert.equal(scopeFor({ ...settings, login: 'user', password: 'new' }), scope);
  assert.notEqual(scopeFor({ ...settings, folder: 'Other' }), scope);
  assert.notEqual(scopeFor({ ...settings, login: 'another' }), scope);
});

test('validates credentials before starting network requests', () => {
  const valid = {
    ...loadPluginData(null).settings,
    login: ' user ',
    password: 'app password',
    folder: '/Obsidian/',
  };
  assert.deepEqual(validateSettings(valid), {
    language: 'ru',
    login: 'user',
    password: 'app password',
    folder: 'Obsidian',
    concurrentRequests: 8,
    requestIntervalMs: 1000,
  });
  for (const settings of [
    { ...valid, login: '' },
    { ...valid, login: 'user:name' },
    { ...valid, password: '' },
    { ...valid, folder: '/' },
  ]) {
    assert.throws(() => validateSettings(settings));
  }
});

test('restores independent request limits and supplies defaults for existing installations', () => {
  const defaults = loadPluginData({ settings: { login: 'old-user' } }).settings;
  assert.equal(defaults.concurrentRequests, 8);
  assert.equal(defaults.requestIntervalMs, 1000);
  const saved = loadPluginData({
    settings: { concurrentRequests: 4, requestIntervalMs: 2500 },
  }).settings;
  assert.equal(saved.concurrentRequests, 4);
  assert.equal(saved.requestIntervalMs, 2500);
  assert.equal(
    scopeFor(saved),
    scopeFor({ ...saved, concurrentRequests: 1, requestIntervalMs: 100 }),
  );
  for (const value of [0, -1, 17, 1.5, '2', null]) {
    assert.equal(
      loadPluginData({ settings: { concurrentRequests: value } }).settings.concurrentRequests,
      8,
    );
  }
  for (const value of [0, -100, 60001, 100.5, '1000', null]) {
    assert.equal(
      loadPluginData({ settings: { requestIntervalMs: value } }).settings.requestIntervalMs,
      1000,
    );
  }
});

test('loads old installations with an empty cache and discards corrupt cache entries without losing sync state', () => {
  const old = loadPluginData(null);
  assert.deepEqual(Object.keys(old.remoteCache.files), []);
  const restored = loadPluginData({
    state: { version: 1, scope: 'account', hashes: { 'a.md': 'a'.repeat(64) } },
    remoteCache: {
      version: 1,
      scope: 'account',
      files: {
        'good.md': { etag: 'b'.repeat(32), hash: 'a'.repeat(64), size: 4 },
        'weak.md': { etag: 'W/"tag"', hash: 'a'.repeat(64), size: 4 },
        'bad.md': { etag: 'b'.repeat(32), hash: 'invalid', size: 4 },
        '../unsafe.md': { etag: 'b'.repeat(32), hash: 'a'.repeat(64), size: 4 },
      },
    },
  });
  assert.deepEqual(Object.keys(restored.remoteCache.files), ['good.md']);
  assert.equal(restored.state.hashes['a.md'], 'a'.repeat(64));
});

test('accepts up to sixteen simultaneous requests', () => {
  const settings = {
    ...loadPluginData(null).settings,
    login: 'user',
    password: 'app password',
    concurrentRequests: 16,
  };
  assert.equal(loadPluginData({ settings }).settings.concurrentRequests, 16);
  assert.equal(validateSettings(settings).concurrentRequests, 16);
});

test('state and cache dictionaries retain special filenames as own keys', () => {
  const hash = 'a'.repeat(64);
  const specialPath = '__proto__';
  const saved = {
    state: { version: 1, scope: 'account', hashes: { [specialPath]: hash } },
    remoteCache: {
      version: 1,
      scope: 'account',
      files: { [specialPath]: { etag: 'b'.repeat(32), hash, size: 4 } },
    },
  };
  const restored = loadPluginData(saved);
  assert.equal(Object.getPrototypeOf(restored.state.hashes), null);
  assert.equal(Object.getPrototypeOf(restored.remoteCache.files), null);
  assert.equal(Object.hasOwn(restored.state.hashes, '__proto__'), true);
  assert.equal(restored.state.hashes['__proto__'], hash);
  assert.equal(restored.remoteCache.files['__proto__']?.hash, hash);
});

const settingsBundle = await build({
  stdin: {
    contents: `export { SyncSettingsTab } from './src/settings/tab';
      export { hostApi } from './tests/helpers/obsidian-host.mjs';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  alias: { obsidian: path.resolve('tests/helpers/obsidian-host.mjs') },
});
const settingsOutput = settingsBundle.outputFiles[0];
assert.ok(settingsOutput);
const { SyncSettingsTab, hostApi } = await import(
  'data:text/javascript;base64,' + Buffer.from(settingsOutput.contents).toString('base64')
);

function settingsFixture() {
  const dom = createDom();
  const calls: string[] = [];
  const plugin = {
    app: { document: dom.window.document },
    data: loadPluginData(null),
    running: false,
    checkingConnection: false,
    connectionResult: undefined as WebDavSync['connectionResult'],
    updateSettings: async (patch: object) => {
      Object.assign(plugin.data.settings, patch);
    },
    testConnection: async () => {
      calls.push('connection');
    },
    runSync: async () => {
      calls.push('sync');
    },
    openLatestLog: async () => {
      calls.push('log');
    },
  };
  const tab = new SyncSettingsTab(plugin);
  const button = (text: string) =>
    [...tab.containerEl.querySelectorAll('button')].find((element) => element.textContent === text);
  return { dom, plugin, tab, calls, button };
}

test('settings definitions expose searchable names without reading credentials or rendering controls', () => {
  const { plugin, tab } = settingsFixture();
  Object.defineProperty(plugin, 'data', {
    get() {
      throw new Error('Indexing must not read settings');
    },
  });
  const definitions: SettingDefinition[] = tab.getSettingDefinitions();
  const names = definitions
    .filter((definition) => definition.searchable !== false)
    .map((definition) => definition.name);
  assert.deepEqual(names, [
    'Language',
    'Yandex login',
    'App password',
    'Yandex Disk folder',
    'Concurrent requests',
    'Request start interval (seconds)',
    'Connection',
    'Run sync',
    'Local sync logs',
  ]);
  assert.equal(tab.containerEl.children.length, 0);
});

test('legacy settings save values, validate the interval and reflect sync activity', () => {
  const { dom, plugin, tab, calls, button } = settingsFixture();
  tab.display();
  const inputs = [...tab.containerEl.querySelectorAll('input')];
  const [login, password, folder, interval] = inputs;
  assert.ok(login && password && folder && interval);
  assert.equal(password.type, 'password');
  assert.equal(password.autocomplete, 'off');
  login.value = 'updated-user';
  login.dispatchEvent(new dom.window.Event('change'));
  interval.value = '0';
  interval.dispatchEvent(new dom.window.Event('change'));
  assert.equal(plugin.data.settings.requestIntervalMs, 1000);
  interval.value = '2.5';
  interval.dispatchEvent(new dom.window.Event('change'));
  assert.equal(plugin.data.settings.requestIntervalMs, 2500);
  interval.value = '0';
  interval.dispatchEvent(new dom.window.Event('blur'));
  assert.equal(interval.value, '2.5');
  assert.equal(plugin.data.settings.login, 'updated-user');
  button('Test connection')?.click();
  button('Preview sync')?.click();
  button('View latest log')?.click();
  assert.deepEqual(calls, ['connection', 'sync', 'log']);

  plugin.checkingConnection = true;
  tab.refreshActivity();
  assert.ok(inputs.every((input) => input.disabled));
  assert.equal(button('Checking…')?.disabled, true);
  assert.equal(button('Preview sync')?.disabled, true);
  plugin.checkingConnection = false;
  plugin.running = true;
  tab.refreshActivity();
  assert.equal(button('View progress')?.disabled, false);
  plugin.running = false;
  plugin.connectionResult = { kind: 'success', message: 'Login and folder access are valid.' };
  tab.refreshActivity();
  assert.ok(inputs.every((input) => !input.disabled));
  assert.match(tab.containerEl.textContent, /Connected/);
  tab.refresh();
  assert.equal(tab.containerEl.querySelectorAll('input').length, 4);
  assert.equal(tab.containerEl.querySelector('input')?.value, 'updated-user');
});

test('settings announce checking, success and failure in a persistent status region', () => {
  const { plugin, tab } = settingsFixture();
  tab.display();
  const status = tab.containerEl.querySelector('[role="status"]');
  assert.ok(status);

  plugin.checkingConnection = true;
  tab.refreshActivity();
  assert.match(status.textContent ?? '', /Checking connection/);

  plugin.checkingConnection = false;
  plugin.connectionResult = { kind: 'success', message: 'Login and folder access are valid.' };
  tab.refreshActivity();
  assert.match(status.textContent ?? '', /Connected.*Login and folder access are valid/);

  plugin.connectionResult = { kind: 'error', message: 'HTTP 401' };
  tab.refreshActivity();
  assert.match(status.textContent ?? '', /Connection failed.*HTTP 401/);
  assert.doesNotMatch(status.textContent ?? '', /Connected/);
});

test('modern settings use host updates and release activity callbacks when rows are removed', () => {
  const { plugin, tab } = settingsFixture();
  const definitions = tab.getSettingDefinitions();
  const language = definitions[0];
  assert.ok(language);
  let updates = 0;
  let disabled = false;
  const dropdown = {
    addOption() {
      return this;
    },
    setValue() {
      return this;
    },
    onChange() {
      return this;
    },
    setDisabled(value: boolean) {
      updates++;
      disabled = value;
      return this;
    },
  };
  const cleanup = language.render({
    addDropdown(callback: (value: typeof dropdown) => void) {
      callback(dropdown);
    },
  });
  assert.equal(updates, 1);
  plugin.running = true;
  tab.refreshActivity();
  assert.equal(disabled, true);
  cleanup?.();
  tab.refreshActivity();
  assert.equal(updates, 2);
  let hostUpdates = 0;
  tab.update = () => {
    hostUpdates++;
  };
  hostApi.version = '1.13.0';
  try {
    tab.refresh();
  } finally {
    hostApi.version = '1.8.7';
  }
  assert.equal(hostUpdates, 1);
  assert.equal(tab.containerEl.children.length, 0);
});

test('closing legacy settings releases activity updates for detached controls', () => {
  const { plugin, tab } = settingsFixture();
  tab.display();
  const login = tab.containerEl.querySelector('input');
  assert.ok(login);
  tab.hide();

  plugin.running = true;
  tab.refreshActivity();
  assert.equal(login.disabled, false);
});

test('settings refresh on older Obsidian uses the legacy renderer even when update exists', () => {
  const { tab } = settingsFixture();
  tab.update = () => {
    throw new Error('The declarative update API requires Obsidian 1.13.0');
  };
  tab.refresh();
  assert.equal(tab.containerEl.querySelectorAll('input').length, 4);
});
