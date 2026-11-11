import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import {
  closeSettings,
  devices,
  openObsidian,
  openSettingsTab,
  setObsidianViewport,
} from '../helpers/obsidian-session.mjs';
import { writeGallery } from './write-gallery.mjs';

const output = resolve('.artifacts/ui-gallery');
const captures = resolve(output, 'screenshots');
const language = process.env.UI_LANGUAGE === 'en' ? 'en' : 'ru';
const themes = ['light', 'dark'];
const selected = process.env.UI_SCENARIOS?.split(',');
const selectedDevices = process.env.UI_DEVICES?.split(',');

await mkdir(captures, { recursive: true });
const session = await openObsidian(output);
const { page, errors, close } = session;
const measurements = [];
try {
  const version = await page.evaluate(
    () => window.app.plugins.plugins['ui-gallery-host'].obsidianVersion,
  );
  let scenarios;
  for (const device of devices.filter(
    (device) => !selectedDevices || selectedDevices.includes(device.id),
  )) {
    await setObsidianViewport(page, device);
    // Keep timers running: Obsidian removes closed modal DOM after a transition.
    await page.clock.setFixedTime(new Date('2026-11-10T09:02:00.000Z'));
    scenarios = await page.evaluate(() => window.syncUiGallery.scenarios);
    for (const theme of themes) {
      await page.evaluate((theme) => {
        document.body.classList.remove('theme-light', 'theme-dark');
        document.body.classList.add(`theme-${theme}`);
      }, theme);
      for (const scenario of scenarios.filter(
        (scenario) => !selected || selected.includes(scenario.id),
      )) {
        await closeSettings(session);
        const state = await page.evaluate(
          ({ id, language }) => window.syncUiGallery.showScenario(id, language),
          { id: scenario.id, language },
        );
        const target = state.settings
          ? await openSettingsTab(session, 'ui-gallery-fixture', device)
          : page;
        await target.evaluate((theme) => {
          document.body.classList.remove('theme-light', 'theme-dark');
          document.body.classList.add(`theme-${theme}`);
        }, theme);
        await expect(target.locator('.modal')).toHaveCount(1);
        if (
          (scenario.id.startsWith('conflict-') &&
            !['conflict-loading', 'conflict-error'].includes(scenario.id)) ||
          scenario.id.startsWith('file-')
        ) {
          await page.locator('.yds-conflict-result').waitFor({ state: 'attached' });
        }
        await page.evaluate((id) => window.syncUiGallery.finishScenario(id), scenario.id);
        await target.evaluate(() => {
          document.activeElement?.blur();
          document
            .querySelectorAll('.modal-content, .vertical-tab-content, .yds-preview-list')
            .forEach((el) => {
              el.scrollTop = 0;
              el.scrollLeft = 0;
            });
        });
        if (scenario.id.startsWith('connection-')) {
          await target
            .getByRole('button', {
              name: /^(Проверить подключение|Проверка…|Test connection|Checking…)$/,
            })
            .scrollIntoViewIfNeeded();
        }
        await target.mouse.move(0, 0);
        await target.evaluate(() => document.fonts.ready);
        if (scenario.id === 'file-image')
          await target.waitForFunction(() =>
            Array.from(document.querySelectorAll('img.yds-attachment-image')).every(
              (image) => image.complete && image.naturalWidth > 0,
            ),
          );
        const filename = `${device.id}-${theme}-${scenario.id}.png`;
        await target.screenshot({ path: resolve(captures, filename), animations: 'disabled' });
        const metrics = await target.evaluate(() => {
          const modal = [...document.querySelectorAll('.modal')].at(-1);
          if (!modal) throw new Error('Expected a visible Obsidian modal');
          const rect = modal.getBoundingClientRect();
          const content = modal.querySelector('.modal-content');
          const visible = (el) =>
            el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
          const buttons = [...modal.querySelectorAll('button, [role=tab]')]
            .filter(visible)
            .map((el) => {
              const r = el.getBoundingClientRect();
              return {
                text: el.textContent.trim(),
                width: Math.round(r.width),
                height: Math.round(r.height),
                right: Math.round(r.right),
              };
            });
          const overflow = [...modal.querySelectorAll('*')]
            .filter(visible)
            .filter((el) => {
              const r = el.getBoundingClientRect();
              return r.right > innerWidth + 1 || r.left < -1;
            })
            .slice(0, 20)
            .map((el) => ({
              tag: el.tagName,
              class: el.className,
              text: el.textContent.slice(0, 120),
            }));
          return {
            viewport: { width: innerWidth, height: innerHeight },
            mobile: document.body.classList.contains('is-mobile'),
            modal: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            },
            content: content
              ? {
                  clientWidth: content.clientWidth,
                  scrollWidth: content.scrollWidth,
                  clientHeight: content.clientHeight,
                  scrollHeight: content.scrollHeight,
                }
              : null,
            buttons,
            overflow,
          };
        });
        const scrolled = await target.evaluate(() => {
          let changed = false;
          document
            .querySelectorAll('.modal-content, .vertical-tab-content, .yds-preview-list')
            .forEach((el) => {
              const start = el.scrollTop;
              el.scrollTop = el.scrollHeight;
              changed ||= el.scrollTop > start + 2;
            });
          return changed;
        });
        if (scrolled) {
          metrics.bottomFile = `screenshots/${device.id}-${theme}-${scenario.id}-bottom.png`;
          await target.screenshot({
            path: resolve(output, metrics.bottomFile),
            animations: 'disabled',
          });
        }
        expect(metrics.viewport).toEqual({ width: device.width, height: device.height });
        expect(metrics.mobile).toBe(device.mobile);
        measurements.push({
          device: device.id,
          theme,
          scenario: scenario.id,
          file: `screenshots/${filename}`,
          ...metrics,
        });
        console.log(`${device.id} · ${theme} · ${scenario.id}`);
      }
    }
  }
  const metadata = {
    capturedAt: new Date().toISOString(),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    obsidianVersion: version,
    language,
    method:
      'Real Obsidian via local CDP; app.emulateMobile for phone layouts; synthetic UI state; no transport',
    devices: devices.filter((device) => !selectedDevices || selectedDevices.includes(device.id)),
    themes,
    scenarios: scenarios.filter((scenario) => !selected || selected.includes(scenario.id)),
    measurements,
    errors,
  };
  await writeFile(resolve(output, 'manifest.json'), JSON.stringify(metadata, null, 2));
  await writeGallery(output, metadata);
  expect(errors).toEqual([]);
  console.log(
    `Gallery: ${resolve(output, 'index.html')} (${measurements.length} screenshots; ${errors.length} page errors)`,
  );
} finally {
  await close();
}
