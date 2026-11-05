import assert from 'node:assert/strict';
import { test } from 'node:test';
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
