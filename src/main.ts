import { Notice, Plugin, requestUrl } from 'obsidian';
import { SyncLog } from './logging/log';
import { LogRepository } from './logging/repository';
import { isIncluded } from './shared/paths';
import {
  emptyState,
  loadPluginData,
  scopeFor,
  validateSettings,
  type PluginData,
  type Settings,
} from './settings/data';
import { SyncSettingsTab } from './settings/tab';
import { executePlan } from './sync/engine';
import { planSync } from './sync/plan';
import { LogViewer } from './ui/log-viewer';
import { confirmSyncPlan } from './ui/preview';
import { SyncReport } from './ui/report';
import { VaultStore } from './vault/store';
import { WebDavStore } from './webdav/store';

export default class WebDavSync extends Plugin {
  data: PluginData = loadPluginData(null);
  running = false;
  private settingsTab?: SyncSettingsTab;
  private status?: HTMLElement;
  private logs?: LogRepository;
  private ready = false;
  private previewController?: AbortController;
  private saveQueue: Promise<void> = Promise.resolve();

  async onload(): Promise<void> {
    this.logs = new LogRepository(this.app.vault.adapter, `${this.pluginFolder()}/logs`);
    this.addCommand({
      id: 'open-latest-log',
      name: 'Open latest sync log',
      callback: () => {
        void this.openLatestLog();
      },
    });

    try {
      this.data = loadPluginData(await this.loadData());
      this.ready = true;
    } catch {
      const log = new SyncLog();
      log.fail('Could not load plugin settings or sync state. Preserve data.json before recovery.');
      await this.saveLog(log);
      new Notice(`gracheveloper's-webdav-sync: ${log.data.failure}`, 15000);
      return;
    }

    this.settingsTab = new SyncSettingsTab(this);
    this.addSettingTab(this.settingsTab);
    this.status = this.addStatusBarItem();
    this.status.setText('Yandex Disk: ready');
    this.addRibbonIcon('refresh-cw', 'Preview sync with Yandex Disk', () => {
      void this.runSync();
    });
    this.addCommand({
      id: 'sync-now',
      name: 'Preview sync with Yandex Disk',
      callback: () => {
        void this.runSync();
      },
    });
  }

  onunload(): void {
    this.ready = false;
    this.previewController?.abort();
  }

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    if (this.running || !this.ready) return;
    Object.assign(this.data.settings, patch);
    try {
      await this.persist();
    } catch {
      new Notice("Could not save gracheveloper's-webdav-sync settings. Check available storage.");
    }
  }

  async runSync(): Promise<void> {
    if (this.running || !this.ready || !this.logs) return;
    this.running = true;
    const controller = new AbortController();
    this.previewController = controller;
    this.settingsTab?.display();
    const notice = new Notice('WebDAV: preparing a read-only preview…', 0);
    const log = new SyncLog();
    log.record('info', 'Starting manual sync', { pluginVersion: this.manifest.version });

    try {
      await this.logs.save(log.data);
      await this.performSync(log, notice, controller.signal);
    } catch (error) {
      log.fail(error instanceof Error ? error.message : 'Unknown error.');
    } finally {
      await this.saveLog(log);
      notice.hide();
      this.running = false;
      this.previewController = undefined;
      this.status?.setText(
        log.data.outcome === 'failed' || log.data.outcome === 'partial'
          ? 'Yandex Disk: needs attention'
          : 'Yandex Disk: ready',
      );
      this.settingsTab?.display();
      if (this.ready && log.data.outcome !== 'cancelled') {
        new SyncReport(this.app, log.data, `${this.logs.folder}/${log.data.id}.json`).open();
      }
    }
  }

  async openLatestLog(): Promise<void> {
    if (!this.logs) return;
    try {
      const log = await this.logs.latest();
      if (!log) {
        new Notice('No sync logs yet. Run a sync first.');
        return;
      }
      new LogViewer(this.app, log, `${this.logs.folder}/latest.json`).open();
    } catch {
      new Notice(
        'Could not read the latest sync log. Preserve the local log file before troubleshooting.',
      );
    }
  }

  private async performSync(log: SyncLog, notice: Notice, signal: AbortSignal): Promise<void> {
    await this.saveQueue;
    const settings = validateSettings(this.data.settings);
    const scope = scopeFor(settings);
    const state = this.data.state.scope === scope ? this.data.state : emptyState(scope);
    log.record('info', 'Using request limits', {
      concurrentRequests: settings.concurrentRequests,
      requestIntervalMs: settings.requestIntervalMs,
    });

    const local = new VaultStore(this.app.vault, `${this.pluginFolder()}/recovery`);
    const remote = new WebDavStore(
      settings,
      async (request) => {
        const response = await requestUrl({ ...request, throw: false });
        return {
          status: response.status,
          headers: response.headers,
          text: response.text,
          arrayBuffer: response.arrayBuffer,
        };
      },
      (path) => isIncluded(path, this.app.vault.configDir),
      log.record,
      {
        concurrentRequests: settings.concurrentRequests,
        requestIntervalMs: settings.requestIntervalMs,
      },
    );
    const plan = await planSync(
      local,
      remote,
      state,
      (path) => {
        this.status?.setText(`WebDAV preview: ${path}`);
      },
      log.record,
      settings.concurrentRequests,
    );
    notice.hide();
    this.status?.setText('WebDAV: awaiting confirmation');
    if (!(await confirmSyncPlan(this.app, plan, signal))) {
      log.cancel();
      return;
    }

    this.data.state = state;
    await this.persist();
    log.record('info', 'User confirmed sync preview');
    const result = await executePlan(
      local,
      remote,
      state,
      plan,
      () => this.persist(),
      (path) => {
        this.status?.setText(`Yandex Disk: ${path}`);
      },
      log.record,
      settings.concurrentRequests,
    );
    log.complete(result);
  }

  private async saveLog(log: SyncLog): Promise<void> {
    try {
      await this.logs?.save(log.data);
    } catch {
      new Notice(
        'Could not save the local sync log. Check available storage. The current report is still available.',
        10000,
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
