import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadPluginData, scopeFor } from '../src/settings/data';

test('loads defaults without sharing the state map', () => {
  const first = loadPluginData(null);
  const second = loadPluginData(null);
  first.state.hashes['a.md'] = 'a'.repeat(64);
  assert.deepEqual(Object.keys(second.state.hashes), []);
  assert.equal(first.settings.folder, 'Obsidian/Personal');
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
  const settings = { login: ' user ', password: 'old', folder: '/Obsidian/Personal/' };
  const scope = scopeFor(settings);
  assert.equal(scopeFor({ ...settings, login: 'user', password: 'new' }), scope);
  assert.notEqual(scopeFor({ ...settings, folder: 'Other' }), scope);
  assert.notEqual(scopeFor({ ...settings, login: 'another' }), scope);
});
