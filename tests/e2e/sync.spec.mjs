import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  closeSettings,
  devices,
  openObsidian,
  openSettingsTab,
  setObsidianViewport,
} from './helpers/obsidian-session.mjs';

let session;
let device;
let profileDirectory;

test.beforeEach(async ({}, testInfo) => {
  device = devices.find(({ id }) => id === testInfo.project.name);
  session = undefined;
  profileDirectory = await mkdtemp(join(tmpdir(), 'obsidian-ui-e2e-'));
  session = await openObsidian(profileDirectory);
  await setObsidianViewport(session.page, device);
});

test.afterEach(async () => {
  try {
    await session?.close();
  } finally {
    if (profileDirectory) await rm(profileDirectory, { recursive: true, force: true });
  }
});

async function expectScreenshot(target, name) {
  await target.page().mouse.move(0, 0);
  await target.evaluate((element) =>
    element.scrollIntoView({ block: 'center', behavior: 'instant' }),
  );
  await expect(target).toHaveScreenshot(`${name}.png`);
}

test('connection check shows success and a failed retry in the settings', async () => {
  const settings = await openSettingsTab(session, 'ui-gallery-host', device);
  const row = settings.locator('.setting-item').filter({ hasText: 'Проверить логин' });
  const check = row.getByRole('button', { name: 'Проверить подключение' });
  const result = row.getByRole('status');

  await check.click();
  await expect(result).toContainText('Подключено');
  await expectScreenshot(row, 'connection-success');

  const password = settings.locator('input[type="password"]');
  await password.fill('invalid-fixture-password');
  await password.press('Tab');
  await expect(result).toBeEmpty();
  await check.click();
  await expect(result).toContainText('Не удалось подключиться');
  await expect(result).toContainText('HTTP 401');
  await expectScreenshot(row, 'connection-error');

  await closeSettings(session);
});

test('sync opens the mode menu, checks files, waits for confirmation and reports the upload', async () => {
  const { page: host } = session;
  const page = await openSettingsTab(session, 'ui-gallery-host', device);
  await page.getByRole('button', { name: 'Открыть предпросмотр' }).click();
  const twoWay = page.getByRole('button', { name: 'Двусторонняя синхронизация', exact: true });
  await expect(twoWay).toBeVisible();
  await expectScreenshot(page.locator('.yds-mode-modal'), 'sync-mode');
  const syncModal = page.locator('.yds-sync-modal');

  await host.evaluate(() => window.syncUiGallery.holdRequest('PROPFIND'));
  await twoWay.click();
  await expect(page.getByText('Проверка файлов', { exact: true })).toBeVisible();
  await expectScreenshot(syncModal, 'sync-checking');
  await host.evaluate(() => window.syncUiGallery.releaseRequest());

  const confirm = page.getByRole('button', { name: 'Подтвердить синхронизацию' });
  await expect(confirm).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Start.md', exact: true })).toBeVisible();
  await expectScreenshot(syncModal, 'sync-preview');

  await syncModal.getByRole('button', { name: 'Start.md', exact: true }).click();
  await expect(syncModal.getByRole('button', { name: 'Сохранить выбор' })).toBeEnabled();
  if (device.mobile) {
    await expect(syncModal.locator('.yds-preview-list')).toHaveCount(0);
  } else {
    await expect(syncModal.locator('.yds-preview-list')).toBeVisible();
    await expect(syncModal.locator('.yds-preview-detail textarea')).toBeVisible();
    await expect(confirm).toBeInViewport();
  }
  await expectScreenshot(syncModal, 'sync-file-review');
  await syncModal
    .getByRole('button', {
      name: device.mobile ? 'Назад к предпросмотру' : 'Закрыть файл',
    })
    .click();

  await host.evaluate(() => window.syncUiGallery.holdRequest('PUT'));
  await confirm.click();
  await expect(page.getByText('Синхронизация файлов', { exact: true })).toBeVisible();
  await expectScreenshot(syncModal, 'sync-transfer');
  await host.evaluate(() => window.syncUiGallery.releaseRequest());

  await expect(page.getByText('Файлы синхронизированы', { exact: true })).toBeVisible();
  await expect(page.locator('.yds-stat').filter({ hasText: 'Добавлено' })).toHaveText('1Добавлено');
  await expectScreenshot(syncModal, 'sync-report');
  expect(session.errors).toEqual([]);
  await closeSettings(session);
});
