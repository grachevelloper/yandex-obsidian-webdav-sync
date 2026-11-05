import { t, setLanguage, type MessageKey } from './i18n';
import { addIcon, getLanguage, Notice, Plugin, setTooltip, type Command } from 'obsidian';

import { SyncLog } from './logging/log';
import { LogRepository } from './logging/repository';
import { isIncluded, isMirrorServicePath } from './shared/paths';
import {
  emptyState,
  loadPluginData,
  scopeFor,
  validateSettings,
  type PluginData,
  type Settings,
} from './settings/data';
import { SyncSettingsTab } from './settings/tab';
import { loadFile } from './sync/load-file';
import { SyncModeMenu } from './ui/sync-mode-menu';
import type { SyncMode } from './sync/types';
import { SyncCancelled } from './sync/errors';
import { executePlan } from './sync/engine';
import { emptyRemoteCache } from './sync/remote-cache';
import { planSync } from './sync/plan';
import { ROOK_ICON_ID, ROOK_ICON_SVG } from './ui/icons';
import { LogViewer } from './ui/log-viewer';
import { SyncWindow } from './ui/sync-window';
import { VaultStore } from './vault/store';
import { checkConnection } from './webdav/connection';
import { obsidianHttp } from './webdav/obsidian-http';
import { WebDavStore } from './webdav/store';

export default class WebDavSync extends Plugin {
  data: PluginData = loadPluginData(null);
  running = false;
  checkingConnection = false;
  connectionResult?: string;
  private settingsTab?: SyncSettingsTab;
  private status?: HTMLElement;
  private logs?: LogRepository;
  private syncWindow?: SyncWindow;
  private modeMenu?: SyncModeMenu;
  private ready = false;
  private ribbon?: HTMLElement;
  private readonly translatedCommands: { command: Command; translationKey: MessageKey }[] = [];
  private syncController?: AbortController;
  private saveQueue: Promise<void> = Promise.resolve();

  async onload(): Promise<void> {
    setLanguage('auto', getLanguage());
    this.logs = new LogRepository(this.app.vault.adapter, `${this.pluginFolder()}/logs`);
    this.translatedCommands.push({
      command: this.addCommand({
        id: 'open-latest-log',
        name: t('Open latest sync log'),
        callback: () => {
          void this.openLatestLog();
        },
      }),
      translationKey: 'Open latest sync log',
    });

    try {
      this.data = loadPluginData(await this.loadData());
      setLanguage(this.data.settings.language, getLanguage());
      this.refreshLanguage();
      this.ready = true;
    } catch {
      const log = new SyncLog();
      log.fail(
        t('Could not load plugin settings or sync state. Preserve data.json before recovery.'),
      );
      await this.saveLog(log);
      new Notice(`WebDAV Sync for Yandex Disk: ${log.data.failure}`, 15000);
      return;
    }

    this.settingsTab = new SyncSettingsTab(this);
    this.addSettingTab(this.settingsTab);
    this.status = this.addStatusBarItem();
    this.status.setText(t('Yandex Disk: ready'));
    this.registerDomEvent(this.status, 'click', () => this.syncWindow?.show());
    this.translatedCommands.push({
      command: this.addCommand({
        id: 'view-sync-progress',
        name: t('View sync progress or last report'),
        callback: () => this.syncWindow?.show(),
      }),
      translationKey: 'View sync progress or last report',
    });
    addIcon(ROOK_ICON_ID, ROOK_ICON_SVG);
    this.ribbon = this.addRibbonIcon(ROOK_ICON_ID, t('Preview sync with Yandex Disk'), () => {
      void this.runSync();
    });
    this.translatedCommands.push({
      command: this.addCommand({
        id: 'sync-now',
        icon: ROOK_ICON_ID,
        name: t('Preview sync with Yandex Disk'),
        callback: () => {
          void this.runSync();
        },
      }),
      translationKey: 'Preview sync with Yandex Disk',
    });
  }

  onunload(): void {
    this.ready = false;
    this.syncController?.abort();
    this.syncWindow?.close();
    this.modeMenu?.close();
  }

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    if (this.running || this.checkingConnection || !this.ready) return;
    this.connectionResult = undefined;
    const previousLanguage = this.data.settings.language;
    Object.assign(this.data.settings, patch);
    try {
      await this.persist();
      if (patch.language) {
        setLanguage(patch.language, getLanguage());
        this.refreshLanguage();
        this.settingsTab?.display();
      }
    } catch {
      if (patch.language) {
        this.data.settings.language = previousLanguage;
        this.settingsTab?.display();
      }
      new Notice(
        t('Could not save WebDAV Sync for Yandex Disk settings. Check available storage.'),
      );
    }
  }

  private refreshLanguage(): void {
    for (const { command, translationKey } of this.translatedCommands) {
      command.name = this.manifest.name + ': ' + t(translationKey);
    }
    if (this.ribbon) setTooltip(this.ribbon, t('Preview sync with Yandex Disk'));
    if (!this.running) this.status?.setText(t('Yandex Disk: ready'));
  }

  async testConnection(): Promise<void> {
    if (this.running || this.checkingConnection || !this.ready) return;
    this.checkingConnection = true;
    this.connectionResult = t('Checking connection…');
    this.settingsTab?.refreshActivity();
    try {
      await this.saveQueue;
      const settings = validateSettings(this.data.settings);
      const result = await checkConnection(settings, obsidianHttp, {
        concurrentRequests: settings.concurrentRequests,
        requestIntervalMs: settings.requestIntervalMs,
      });
      this.connectionResult = result.folderExists
        ? t('Connected. Login, app password and folder access are valid. No files were changed.')
        : t(
            'Connected. Login and app password are valid, but the selected folder does not exist. No folder was created.',
          );
    } catch (error) {
      this.connectionResult =
        error instanceof Error ? error.message : t('Connection check failed.');
    } finally {
      new Notice(this.connectionResult);
      this.checkingConnection = false;
      this.settingsTab?.refreshActivity();
    }
  }

  stopSync(): void {
    this.syncController?.abort();
  }

  async runSync(): Promise<void> {
    if (this.running) {
      if (!this.modeMenu) this.syncWindow?.show();
      return;
    }
    if (!this.ready || !this.logs || this.checkingConnection) return;
    this.running = true;
    const controller = new AbortController();
    this.syncController = controller;
    this.settingsTab?.refreshActivity();

    try {
      const menu = new SyncModeMenu(this.app);
      this.modeMenu = menu;
      const mode = await menu.choose(controller.signal);
      this.modeMenu = undefined;
      if (mode) await this.runSelectedSync(mode, controller.signal);
    } finally {
      controller.abort();
      this.modeMenu = undefined;
      this.running = false;
      this.syncController = undefined;
      this.settingsTab?.refreshActivity();
    }
  }

  private async runSelectedSync(mode: SyncMode, signal: AbortSignal): Promise<void> {
    if (!this.logs) return;
    const log = new SyncLog();
    this.syncWindow?.close();
    const window = new SyncWindow(
      this.app,
      log.data,
      this.logs.folder + '/' + log.data.id + '.json',
      () => this.stopSync(),
    );
    this.syncWindow = window;
    window.show();
    log.record('info', t('Starting manual sync'), { pluginVersion: this.manifest.version, mode });

    try {
      await this.logs.save(log.data);
      await this.performSync(log, window, signal, mode);
    } catch (error) {
      if (error instanceof SyncCancelled) log.cancel(error.result);
      else log.fail(error instanceof Error ? error.message : t('Unknown error.'));
    } finally {
      const warning = await this.saveLog(log);
      window.finish(warning);
      this.status?.setText(
        log.data.outcome === 'failed' || log.data.outcome === 'partial'
          ? t('Yandex Disk: needs attention')
          : t('Yandex Disk: ready'),
      );
    }
  }

  async openLatestLog(): Promise<void> {
    if (!this.logs) return;
    try {
      const log = await this.logs.latest();
      if (!log) {
        new Notice(t('No sync logs yet. Run a sync first.'));
        return;
      }
      new LogViewer(this.app, log, `${this.logs.folder}/latest.json`).open();
    } catch {
      new Notice(
        t(
          'Could not read the latest sync log. Preserve the local log file before troubleshooting.',
        ),
      );
    }
  }

  private async performSync(
    log: SyncLog,
    window: SyncWindow,
    signal: AbortSignal,
    mode: SyncMode,
  ): Promise<void> {
    await this.saveQueue;
    const settings = validateSettings(this.data.settings);
    const scope = scopeFor(settings);
    const state = this.data.state.scope === scope ? this.data.state : emptyState(scope);
    if (this.data.remoteCache.scope !== scope) this.data.remoteCache = emptyRemoteCache(scope);
    log.record('info', t('Using request limits'), {
      concurrentRequests: settings.concurrentRequests,
      requestIntervalMs: settings.requestIntervalMs,
    });

    const include = (path: string) =>
      isIncluded(path, this.app.vault.configDir) &&
      (mode === 'two-way' || !isMirrorServicePath(path));
    const local = new VaultStore(this.app.vault, `${this.pluginFolder()}/recovery`, include);
    const remote = new WebDavStore(
      settings,
      obsidianHttp,
      include,
      log.record,
      {
        signal,
        concurrentRequests: settings.concurrentRequests,
        requestIntervalMs: settings.requestIntervalMs,
        onRequest: (method, path) => window.requestStarted(method, path),
        onRetry: (retry) => window.waiting(retry),
      },
      this.data.remoteCache,
      mode === 'cloud-wins',
    );
    window.setFileLoader((entry) => loadFile(local, remote, entry, signal));
    const plan = await planSync(
      local,
      remote,
      state,
      (progress) => {
        window.update(progress);
        this.status?.setText(
          progress.total === undefined
            ? t('WebDAV: listing folders…')
            : t('WebDAV check: {0} / {1}', { '0': progress.processed, '1': progress.total }),
        );
      },
      log.record,
      settings.concurrentRequests,
      signal,
      mode,
    );
    await this.persist();
    this.status?.setText(t('WebDAV: awaiting confirmation'));
    if (!(await window.confirm(plan, signal))) {
      log.cancel();
      return;
    }

    this.data.state = state;
    await this.persist();
    log.record('info', t('User confirmed sync preview'));
    const result = await executePlan(
      local,
      remote,
      state,
      plan,
      () => this.persist(),
      (progress) => {
        window.update(progress);
        this.status?.setText(
          t('WebDAV sync: {0} / {1}', { '0': progress.processed, '1': progress.total }),
        );
      },
      log.record,
      settings.concurrentRequests,
      signal,
    );
    log.complete(result);
  }

  private async saveLog(log: SyncLog): Promise<string | undefined> {
    try {
      await this.logs?.save(log.data);
    } catch {
      return t(
        'Could not save the local sync log. Check available storage. The current report is still available.',
      );
    }
  }

  private pluginFolder(): string {
    return `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
  }

  private persist(): Promise<void> {
    const value: unknown = JSON.parse(JSON.stringify(this.data));
    const save = this.saveQueue.then(() => this.saveData(value));
    this.saveQueue = save.catch(() => {});
    return save;
  }
}
