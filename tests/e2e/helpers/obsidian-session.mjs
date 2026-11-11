import { execFile, spawn } from 'node:child_process';
import { copyFile, mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const executable = resolve(
  process.env.OBSIDIAN_EXECUTABLE ?? '/Applications/Obsidian.app/Contents/MacOS/Obsidian',
);
const appBundle =
  process.platform === 'darwin'
    ? executable.match(/^(.*\.app)\/Contents\/MacOS\/[^/]+$/u)?.[1]
    : undefined;
const run = promisify(execFile);

export const devices = [
  { id: 'phone-370', title: 'Телефон · 370 × 800', width: 370, height: 800, mobile: true },
  { id: 'phone-420', title: 'Телефон · 420 × 900', width: 420, height: 900, mobile: true },
  { id: 'desktop', title: 'Компьютер · 1440 × 1000', width: 1440, height: 1000, mobile: false },
];

export async function openObsidian(output) {
  const vault = resolve(output, 'vault');
  const profile = resolve(output, 'profile');

  await mkdir(resolve(vault, '.obsidian'), { recursive: true });
  await mkdir(profile, { recursive: true });
  const pluginFolder = resolve(vault, '.obsidian/plugins/ui-gallery-host');
  await mkdir(pluginFolder, { recursive: true });
  await writeFile(
    resolve(vault, 'Start.md'),
    '# UI preview\n\nSynthetic note used to test synchronization.\n',
  );
  await writeFile(
    resolve(vault, '.obsidian', 'app.json'),
    JSON.stringify({ showReleaseNotes: false }),
  );
  await writeFile(resolve(vault, '.obsidian', 'core-plugins.json'), '["file-explorer"]');
  await writeFile(
    resolve(profile, 'obsidian.json'),
    JSON.stringify({
      updateDisabled: true,
      vaults: { a11ce00000000001: { path: vault, ts: Date.now(), open: true } },
    }),
  );
  let mockedTransport = false;
  const bundle = await build({
    entryPoints: ['tests/e2e/helpers/plugin.ts'],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'browser',
    external: ['obsidian'],
    target: 'es2022',
    plugins: [
      {
        name: 'test-webdav',
        setup(build) {
          build.onResolve({ filter: /^\.\/webdav\/obsidian-http$/ }, () => {
            mockedTransport = true;
            return { path: resolve('tests/e2e/helpers/http-fixture.ts') };
          });
        },
      },
    ],
  });
  if (!mockedTransport) throw new Error('The test WebDAV transport was not installed');

  await writeFile(resolve(pluginFolder, 'main.js'), bundle.outputFiles[0].text);
  await writeFile(
    resolve(pluginFolder, 'manifest.json'),
    JSON.stringify({
      id: 'ui-gallery-host',
      name: 'UI gallery fixtures',
      version: '0.0.0',
      minAppVersion: '1.8.7',
      description: 'Synthetic UI states only',
      author: 'Fixture',
      isDesktopOnly: false,
    }),
  );
  await writeFile(
    resolve(vault, '.obsidian/community-plugins.json'),
    JSON.stringify(['ui-gallery-host']),
  );
  await copyFile('styles.css', resolve(pluginFolder, 'styles.css'));
  await writeFile(
    resolve(pluginFolder, 'data.json'),
    JSON.stringify({
      settings: {
        login: 'fixture',
        password: 'fixture-password',
        folder: 'Fixture',
        requestIntervalMs: 100,
      },
    }),
  );
  const host = await launchHost(profile, resolve(output, 'obsidian-process.log'));
  let browser;
  try {
    const endpoint = await host.endpoint();
    browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? (await context.waitForEvent('page', { timeout: 30000 }));
    page.setDefaultTimeout(15000);
    await page.waitForFunction(() => window.app?.workspace?.layoutReady);
    const trust = page.getByRole('button', {
      name: /Trust author and enable plugins|Довериться автору и включить плагины/,
    });
    if (await trust.isVisible()) await trust.click();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') console.error(message.text());
    });
    await page.evaluate(async () => {
      if (!window.app.plugins.plugins['ui-gallery-host'])
        await window.app.plugins.loadPlugin('ui-gallery-host');
    });
    await page.waitForFunction(() => window.app.plugins.plugins['ui-gallery-host']);
    return { context, page, errors, close };
  } catch (error) {
    await close();
    throw error;
  }

  async function close() {
    try {
      await browser?.close();
    } finally {
      await host.stop();
    }
  }
}

async function launchHost(profile, logPath) {
  const activePort = resolve(profile, 'DevToolsActivePort');
  if (appBundle && (await isolatedProcessId(profile))) {
    throw new Error(`Obsidian is already using the test profile: ${profile}`);
  }
  await rm(activePort, { force: true });

  const args = [
    `--user-data-dir=${profile}`,
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    '--no-sandbox',
  ];
  const log = await open(logPath, 'w');
  const child = appBundle
    ? spawn(
        '/usr/bin/open',
        ['-g', '-j', '-n', '-W', '-a', appBundle, '--stderr', logPath, '--args', ...args],
        {
          stdio: ['ignore', 'ignore', log.fd],
        },
      )
    : spawn(executable, args, { stdio: ['ignore', log.fd, log.fd] });
  let launchError;
  const exited = new Promise((done) => {
    child.once('exit', done);
    child.once('error', (error) => {
      launchError = error;
      done();
    });
  });
  await log.close();

  return {
    async endpoint() {
      const deadline = performance.now() + 30000;
      while (performance.now() < deadline) {
        if (launchError) throw launchError;
        if (child.exitCode !== null || child.signalCode !== null)
          throw new Error(`Obsidian exited before connection. See ${logPath}`);

        const contents = await readFile(activePort, 'utf8').catch((error) => {
          if (error.code === 'ENOENT') return '';
          throw error;
        });
        const [port, path] = contents.trim().split(/\r?\n/u);
        if (/^\d+$/u.test(port) && path?.startsWith('/devtools/browser/'))
          return `ws://127.0.0.1:${port}${path}`;
        await delay(50);
      }
      throw new Error(`Obsidian did not expose a debugging endpoint within 30s. See ${logPath}`);
    },
    async stop() {
      const pid = appBundle ? await isolatedProcessId(profile) : child.pid;
      if (pid) {
        try {
          process.kill(pid);
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      } else {
        child.kill();
      }
      await exited;
    },
  };
}

async function isolatedProcessId(profile) {
  // Launch Services starts Obsidian separately from the process running `open -W`.
  const { stdout } = await run('/bin/ps', ['-axo', 'pid=,command=']);
  for (const line of stdout.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(.*)$/u);
    if (match?.[2].startsWith(`${executable} --user-data-dir=${profile} `)) return Number(match[1]);
  }
}

export async function setObsidianViewport(page, device) {
  await page.setViewportSize({ width: device.width, height: device.height });
  if ((await page.evaluate(() => window.app.isMobile)) !== device.mobile) {
    await page.evaluate((mobile) => window.app.emulateMobile(mobile), device.mobile);
    await page.waitForFunction(
      (mobile) => window.app?.workspace?.layoutReady && window.app.isMobile === mobile,
      device.mobile,
    );
  }
  await page.evaluate(async () => {
    if (!window.app.plugins.plugins['ui-gallery-host'])
      await window.app.plugins.loadPlugin('ui-gallery-host');
  });
  await page.waitForFunction(() => window.app.plugins.plugins['ui-gallery-host']);
  await page.evaluate(() => {
    window.syncUiGallery = window.app.plugins.plugins['ui-gallery-host'];
  });
}

export async function openSettingsTab({ page, context }, id, device) {
  const inPopout = await page.evaluate(async (id) => {
    await window.app.setting.open();
    window.app.setting.openTabById(id);
    return window.app.setting.modalEl.ownerDocument !== document;
  }, id);
  const target = inPopout
    ? (context.pages().find((candidate) => candidate !== page) ??
      (await context.waitForEvent('page')))
    : page;
  await target.setViewportSize({ width: device.width, height: device.height });
  return target;
}

export async function closeSettings({ page, context }) {
  const closing = context
    .pages()
    .filter((candidate) => candidate !== page)
    .map((popup) => popup.waitForEvent('close'));
  await page.evaluate(() => window.app.setting.close());
  await Promise.all(closing);
}
