import { Modal, apiVersion, type App } from 'obsidian';
import WebDavSync from '../../../src/main';
import { holdRequest, releaseRequest } from './http-fixture';
import { setLanguage, t } from '../../../src/i18n';
import { SyncLog } from '../../../src/logging/log';
import { SyncSettingsTab } from '../../../src/settings/tab';
import type { FileLoader } from '../../../src/sync/load-file';
import type { PlanEntry, SyncPlan, SyncResult } from '../../../src/sync/types';
import { SyncModeMenu } from '../../../src/ui/sync-mode-menu';
import { SyncWindow } from '../../../src/ui/sync-window';
import { LogViewer } from '../../../src/ui/log-viewer';

const scenarioDefinitions: [string, string, string][] = [
  ['settings', 'Настройки', 'Подключение'],
  ['connection-checking', 'Проверка подключения', 'Подключение'],
  ['connection-success', 'Подключение установлено', 'Подключение'],
  ['connection-error', 'Ошибка подключения', 'Подключение'],
  ['mode', 'Выбор режима', 'Запуск'],
  ['listing', 'Получение списка папок', 'Проверка'],
  ['checking', 'Сравнение файлов', 'Проверка'],
  ['preview', 'Список изменений и конфликт', 'Предпросмотр'],
  ['preview-empty', 'Изменений нет', 'Предпросмотр'],
  ['preview-error', 'Ошибка блокирует подтверждение', 'Предпросмотр'],
  ['mirror-upload', 'Точная копия: устройство → Диск', 'Предпросмотр'],
  ['mirror-download', 'Точная копия: Диск → устройство', 'Предпросмотр'],
  ['preview-resolved', 'Конфликт решён, можно подтвердить', 'Предпросмотр'],
  ['preview-long', 'Глубокие папки и длинные имена', 'Предпросмотр'],
  ['preview-many', 'Большой список: 150 файлов', 'Предпросмотр'],
  ['file-text', 'Просмотр отдельной заметки', 'Просмотр файлов'],
  ['file-image', 'Просмотр изображения', 'Просмотр файлов'],
  ['file-binary', 'Вложение без предпросмотра', 'Просмотр файлов'],
  ['conflict-loading', 'Загрузка версий', 'Конфликты'],
  ['conflict-local', 'Конфликт: локальная версия', 'Конфликты'],
  ['conflict-remote', 'Конфликт: версия Диска', 'Конфликты'],
  ['conflict-result', 'Конфликт: редактирование результата', 'Конфликты'],
  ['conflict-replace', 'Подтверждение замены правок', 'Конфликты'],
  ['conflict-error', 'Ошибка чтения версий', 'Конфликты'],
  ['sync', 'Передача файлов', 'Синхронизация'],
  ['rate-limit', 'Пауза по просьбе Диска', 'Синхронизация'],
  ['network-retry', 'Повтор после обрыва связи', 'Синхронизация'],
  ['stopping', 'Остановка: ожидание запросов', 'Синхронизация'],
  ['saving-report', 'Сохранение отчёта', 'Синхронизация'],
  ['report-success', 'Успешный отчёт', 'Результат'],
  ['report-current', 'Всё актуально', 'Результат'],
  ['report-partial', 'Часть файлов с ошибками', 'Результат'],
  ['report-failed', 'Синхронизация прервана ошибкой', 'Результат'],
  ['report-cancelled', 'Отменено пользователем', 'Результат'],
  ['report-warning', 'Не удалось сохранить журнал', 'Результат'],
  ['log', 'Диагностический журнал', 'Результат'],
];

export const scenarios = scenarioDefinitions.map(([id, title, group]) => ({ id, title, group }));

const localNote = '# Покупки\n\n- Хлеб\n- Молоко\n- Яблоки\n\nДобавлено на телефоне.';
const remoteNote = '# Покупки\n\n- Хлеб\n- Молоко\n- Чай\n\nДобавлено на компьютере.';
const conflictPath = 'Заметки/Покупки.md';
const logPath = '.obsidian/plugins/ui-gallery-fixture/logs/example.json';
const longPath =
  'Проекты/Личное/Путешествия/2026/Ноябрь/Подготовка/Билеты/Очень длинное название заметки с деталями поездки и бронирования.md';
const entries: PlanEntry[] = [
  { path: 'Заметки/Новая заметка.md', action: 'upload', localHash: 'local' },
  { path: 'Заметки/Планы на неделю.md', action: 'download', remoteHash: 'remote' },
  { path: conflictPath, action: 'conflict', localHash: 'local', remoteHash: 'remote' },
  { path: 'Вложения/Маршрут.png', action: 'download', remoteHash: 'image' },
  { path: 'Вложения/Архив.zip', action: 'upload', localHash: 'binary' },
  { path: 'Архив/Старое видео.mp4', action: 'skip', message: 'Файл больше 50 МиБ.' },
  { path: 'Заметки/Без изменений.md', action: 'unchanged', localHash: 'same', remoteHash: 'same' },
];

const reviewExamples: PlanEntry[] = [
  { path: 'Заметки/Бюджет.md', action: 'upload', localHash: 'edited', remoteHash: 'common' },
  {
    path: 'Заметки/Избранное.md',
    action: 'move',
    baseline: 'same',
    remoteHash: 'same',
    move: { targetPath: 'Архив/Избранное.md', localHash: 'same' },
  },
  {
    path: 'Заметки/Поездка.md',
    action: 'merge',
    localHash: 'local',
    remoteHash: 'remote',
    merge: [{ text: '# Поездка\n\nБилеты куплены.' }],
  },
  {
    path: 'Заметки/Старое имя.md',
    action: 'download',
    remoteHash: 'remote',
    renameTo: 'Заметки/Новое имя.md',
    resolution: { kind: 'remote' },
  },
];

const result: SyncResult = {
  uploaded: 3,
  downloaded: 2,
  resolved: 1,
  edited: 1,
  conflicts: [],
  skipped: [],
  errors: [],
};

let active: Modal | undefined;
let controller: AbortController | undefined;
let settingsPlugin: WebDavSync | undefined;
let settingsTab: SyncSettingsTab | undefined;

function makeLog() {
  const log = new SyncLog();
  Object.assign(log.data, {
    id: 'fixture-run',
    startedAt: '2026-11-10T09:00:00.000Z',
    events: [
      {
        time: '2026-11-10T09:00:00.000Z',
        level: 'info',
        message: 'Пример журнала: начало проверки',
      },
      {
        time: '2026-11-10T09:00:01.000Z',
        level: 'info',
        message: 'PROPFIND',
        details: { status: 207, path: 'Заметки' },
      },
    ],
  });
  return log;
}

function click(label: string) {
  const button = Array.from(active?.contentEl.querySelectorAll('button') ?? []).find(
    (button) => button.textContent === label,
  );
  if (!button) throw new Error(`Fixture button not found: ${label}`);
  button.click();
}

function imageBytes() {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 160;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  context.fillStyle = '#f2efe8';
  context.fillRect(0, 0, 320, 160);
  context.fillStyle = '#4d756a';
  context.fillRect(30, 35, 110, 90);
  context.fillStyle = '#7756b5';
  context.fillRect(165, 60, 120, 65);
  context.fillStyle = '#222222';
  context.font = '16px sans-serif';
  context.fillText('Тестовое вложение', 30, 25);
  return Uint8Array.from(
    atob(canvas.toDataURL('image/png').slice('data:image/png;base64,'.length)),
    (c) => c.charCodeAt(0),
  ).buffer;
}

function loader(scenario: string): FileLoader {
  return async (entry) => {
    if (scenario === 'conflict-loading') return new Promise(() => {});
    if (scenario === 'conflict-error')
      throw new Error('Файл изменился после проверки. Подготовьте новый предпросмотр.');
    const binary = entry.path.endsWith('.zip');
    const image = entry.path.endsWith('.png');
    const local = image
      ? imageBytes()
      : new TextEncoder().encode(binary ? 'fixture zip' : localNote).buffer;
    const remote = image
      ? imageBytes()
      : new TextEncoder().encode(binary ? 'fixture zip' : remoteNote).buffer;
    return {
      local: entry.localHash ? { hash: entry.localHash, data: local } : undefined,
      remote: entry.remoteHash ? { hash: entry.remoteHash, data: remote } : undefined,
    };
  };
}

export function showScenario(app: App, id: string, language: 'ru' | 'en' = 'ru') {
  if (!scenarios.some((scenario) => scenario.id === id)) throw new Error(`Unknown scenario: ${id}`);
  controller?.abort();
  active?.close();
  active = undefined;
  controller = new AbortController();
  setLanguage(language);

  if (id === 'settings' || id.startsWith('connection-')) {
    if (!settingsPlugin) {
      settingsPlugin = new WebDavSync(app, {
        id: 'ui-gallery-fixture',
        name: 'WebDAV Sync for Yandex Disk',
        version: '0.0.0',
        minAppVersion: '1.8.7',
        author: 'Fixture',
        description: 'Isolated UI fixtures',
      });
      settingsPlugin.data.settings.login = 'example-user';
      settingsPlugin.data.settings.password = 'example-only';
      settingsTab = new SyncSettingsTab(settingsPlugin);
      settingsPlugin.addSettingTab(settingsTab);
    }
    settingsPlugin.checkingConnection = id === 'connection-checking';
    settingsPlugin.connectionResult =
      id === 'connection-success'
        ? {
            kind: 'success',
            message: t('Login, app password and folder access are valid. No files were changed.'),
          }
        : id === 'connection-error'
          ? { kind: 'error', message: 'HTTP 401 · Проверьте логин и пароль приложения.' }
          : undefined;
    settingsTab?.display();
    return { settings: true };
  }

  if (id === 'mode') {
    const menu = new SyncModeMenu(app);
    active = menu;
    void menu.choose(controller.signal);
    return {};
  }

  const log = makeLog();
  if (id === 'log') {
    log.complete(structuredClone(result));
    log.data.finishedAt = '2026-11-10T09:02:00.000Z';
    active = new LogViewer(app, log.data, logPath);
    active.open();
    return {};
  }

  const window = new SyncWindow(app, log.data, logPath, () => {});
  active = window;
  window.setFileLoader(loader(id));
  window.show();

  if (id === 'listing' || id === 'checking') {
    window.update({
      phase: id === 'checking' ? 'preview' : 'listing',
      processed: id === 'checking' ? 12 : 0,
      total: id === 'checking' ? 36 : undefined,
      activePaths: id === 'checking' ? ['Заметки/Покупки.md', 'Заметки/Планы на неделю.md'] : [],
    });
    window.requestStarted(id === 'checking' ? 'GET' : 'PROPFIND', 'Заметки/Планы на неделю.md');
    return {};
  }

  if (
    id.startsWith('preview') ||
    id.startsWith('mirror') ||
    id.startsWith('conflict') ||
    id.startsWith('file-')
  ) {
    const plan: SyncPlan = { scope: 'fixture', mode: 'two-way', entries: structuredClone(entries) };
    if (id === 'preview') plan.entries.push(...reviewExamples);
    if (id === 'conflict-result') {
      const conflict = plan.entries.find((entry) => entry.path === conflictPath);
      if (conflict)
        conflict.merge = [
          { text: '# Покупки\n\n- Хлеб\n- Молоко\n' },
          { local: '- Яблоки\n', remote: '- Чай\n', base: '- Фрукты\n' },
          { text: '\nСписок дополнен перед поездкой.' },
        ];
    }
    if (id === 'preview-empty') plan.entries = [];
    if (id === 'preview-error')
      plan.entries.push({
        path: 'Заметки/README.md',
        action: 'error',
        message: 'Имена README.md и readme.md различаются только регистром.',
      });
    if (id === 'preview-long')
      plan.entries = [
        { path: longPath, action: 'download', remoteHash: 'remote' },
        { path: longPath.replace('.md', '.дополнение.md'), action: 'upload', localHash: 'local' },
      ];
    if (id === 'preview-many')
      plan.entries = Array.from({ length: 150 }, (_, index) => ({
        path: `Заметки/Запись ${String(index + 1).padStart(3, '0')}.md`,
        action: index % 2 ? 'download' : 'upload',
        localHash: 'local',
        remoteHash: 'remote',
      }));
    if (id === 'preview-resolved') {
      const conflict = plan.entries.find((entry) => entry.action === 'conflict');
      if (!conflict) throw new Error('Fixture conflict missing');
      conflict.resolution = {
        kind: 'text',
        text: localNote + '\n- Чай',
      };
    }
    if (id.startsWith('mirror')) {
      const upload = id === 'mirror-upload';
      plan.mode = upload ? 'device-wins' : 'cloud-wins';
      plan.entries = [
        {
          path: conflictPath,
          action: upload ? 'upload' : 'download',
          localHash: 'local',
          remoteHash: 'remote',
        },
        { path: 'Архив/Старая заметка.md', action: upload ? 'delete-remote' : 'delete-local' },
      ];
    }
    void window.confirm(plan, controller.signal);
    if (id.startsWith('conflict')) click(t('Resolve conflicts (') + '1)');
    if (id.startsWith('file-')) {
      const name =
        id === 'file-text'
          ? 'Планы на неделю.md'
          : id === 'file-image'
            ? 'Маршрут.png'
            : 'Архив.zip';
      const button = Array.from(
        window.contentEl.querySelectorAll<HTMLButtonElement>('.yds-preview-open'),
      ).find((button) => button.textContent === name);
      if (!button) throw new Error('Fixture file button not found');
      button.click();
    }
    return {};
  }

  if (id.startsWith('report-')) {
    const totals = structuredClone(result);
    if (id === 'report-success')
      Object.assign(totals, { added: 2, updated: 1, merged: 1, moved: 1, renamed: 1 });
    if (id === 'report-partial') {
      totals.errors = [
        'Заметки/Покупки.md: HTTP 412 · файл изменился на Диске. Запустите проверку снова.',
      ];
      totals.skipped = ['Вложения/Большое видео.mp4: больше 50 МиБ'];
    }
    if (id === 'report-current')
      Object.assign(totals, { uploaded: 0, downloaded: 0, resolved: 0, edited: 0 });
    if (id === 'report-failed')
      log.fail(
        'Не удалось подключиться к Яндекс Диску. Проверьте интернет и повторите синхронизацию.',
      );
    else if (id === 'report-cancelled') log.cancel({ ...totals, uploaded: 1, downloaded: 0 });
    else log.complete(totals);
    log.data.finishedAt = '2026-11-10T09:02:00.000Z';
    window.update({
      phase: 'sync',
      processed: id === 'report-cancelled' ? 1 : 7,
      total: 7,
      activePaths: [],
    });
    window.finish(
      id === 'report-warning'
        ? t(
            'Could not save the local sync log. Check available storage. The current report is still available.',
          )
        : undefined,
    );
    return {};
  }

  // Enter transfer mode through the same confirmation button used by the plugin.
  void window.confirm(
    {
      scope: 'fixture',
      mode: 'two-way',
      entries: entries.filter((entry) => entry.action === 'upload' || entry.action === 'download'),
    },
    controller.signal,
  );
  click(t('Confirm sync'));
  window.update({
    phase: 'sync',
    processed: id === 'saving-report' ? 36 : 12,
    total: 36,
    activePaths:
      id === 'saving-report' ? [] : ['Заметки/Планы на неделю.md', 'Вложения/Маршрут.png'],
  });
  window.requestStarted('PUT', 'Заметки/Планы на неделю.md');
  if (id === 'rate-limit' || id === 'network-retry')
    window.waiting({
      reason: id === 'rate-limit' ? 'rate-limit' : 'network',
      delayMs: 30000,
      attempt: 1,
    });
  if (id === 'stopping') click(t('Stop sync'));
  return {};
}

export function finishScenario(id: string) {
  if (id === 'file-image') click(t('Yandex Disk'));
  if (id === 'conflict-local' || id === 'conflict-remote') {
    click(id === 'conflict-local' ? t('Local') : t('Yandex Disk'));
  }
  if (id === 'conflict-replace') {
    const editor = active?.contentEl.querySelector('textarea');
    if (!editor) throw new Error('Fixture result editor missing');
    editor.value += '\nМоя дополнительная правка';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    click(t('Use both'));
  }
}

export default class GalleryFixture extends WebDavSync {
  scenarios = scenarios;
  obsidianVersion = apiVersion;
  holdRequest = holdRequest;
  releaseRequest = releaseRequest;

  showScenario(id: string, language: 'ru' | 'en') {
    return showScenario(this.app, id, language);
  }

  finishScenario(id: string) {
    finishScenario(id);
  }
}
