import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import * as obsidian from '../helpers/obsidian-host.mjs';

const bundle = await readFile('main.js', 'utf8');
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));

function mobileRuntime() {
  const dom = new JSDOM();
  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    window: dom.window,
    DOMParser: dom.window.DOMParser,
    TextEncoder,
    TextDecoder,
    URL,
    AbortController,
    btoa: dom.window.btoa.bind(dom.window),
    require(name) {
      assert.equal(name, 'obsidian', 'Mobile plugins may only import the Obsidian host');
      return obsidian;
    },
  });
  return { dom, module, context };
}

test('the release bundle loads, initializes and checks WebDAV without Node globals', async () => {
  const { dom, module, context } = mobileRuntime();
  const previousSend = obsidian.http.send;
  try {
    assert.equal(vm.runInContext('typeof Buffer', context), 'undefined');
    assert.equal(vm.runInContext('typeof process', context), 'undefined');
    vm.runInContext(bundle, context, { filename: 'main.js', timeout: 5000 });
    const plugin = new module.exports.default(
      { document: dom.window.document, vault: { configDir: '.obsidian', adapter: {} } },
      manifest,
    );
    const commands = [];
    const tabs = [];
    plugin.addCommand = (command) => {
      commands.push(command.id);
      return command;
    };
    plugin.addSettingTab = (tab) => tabs.push(tab);
    await plugin.onload();
    assert.ok(commands.includes('sync-now'));
    assert.equal(tabs.length, 1);
    assert.ok(tabs[0].getSettingDefinitions().length > 0);
    const requestedPaths = [];
    obsidian.http.send = async (request) => {
      const path = new URL(request.url).pathname;
      requestedPaths.push(path);
      return {
        status: 207,
        headers: {},
        arrayBuffer: new ArrayBuffer(0),
        text: `<d:multistatus xmlns:d="DAV:"><d:response><d:href>${path}</d:href>
          <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>
          <d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`,
      };
    };
    Object.assign(plugin.data.settings, {
      login: 'mobile-test',
      password: 'test-only',
      folder: 'Obsidian',
      requestIntervalMs: 100,
    });
    await plugin.testConnection();
    assert.deepEqual(requestedPaths, ['/', '/Obsidian']);
    assert.equal(plugin.checkingConnection, false);
    assert.equal(plugin.connectionResult.kind, 'success');
    assert.equal(
      plugin.connectionResult.message,
      'Логин, пароль приложения и доступ к папке верны. Файлы не изменялись.',
    );
    plugin.onunload();
  } finally {
    obsidian.http.send = previousSend;
    dom.window.close();
  }
});
