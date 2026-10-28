import { Notice, Plugin, requestUrl } from 'obsidian';
import { isIncluded } from './shared/paths';
import {
  emptyState,
  loadPluginData,
  scopeFor,
  type PluginData,
  type Settings,
} from './settings/data';
import { SyncSettingsTab } from './settings/tab';
import { synchronize } from './sync/engine';
import { resultText, SyncReport } from './ui/report';
import { VaultStore } from './vault/store';
import { WebDavStore } from './webdav/store';

export default class YandexDiskSync extends Plugin {
  data: PluginData = loadPluginData(null);
  running = false;
  private settingsTab?: SyncSettingsTab;
  private status?: HTMLElement;
  private ready = false;
  private saveQueue: Promise<void> = Promise.resolve();

  async onload(): Promise<void> {
    try {
      this.data = loadPluginData(await this.loadData());
      this.ready = true;
    } catch (error) {
      new Notice(
        `Yandex Disk Sync: ${error instanceof Error ? error.message : 'Не удалось загрузить настройки.'}`,
        15000,
      );
      return;
    }

    this.settingsTab = new SyncSettingsTab(this);
    this.addSettingTab(this.settingsTab);
    this.status = this.addStatusBarItem();
    this.status.setText('Яндекс Диск: готов');
    this.addRibbonIcon('refresh-cw', 'Синхронизировать с Яндекс Диском', () => {
      void this.runSync();
    });
    this.addCommand({
      id: 'sync-now',
      name: 'Синхронизировать с Яндекс Диском',
      callback: () => {
        void this.runSync();
      },
    });
  }

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    if (this.running || !this.ready) return;
    Object.assign(this.data.settings, patch);

    try {
      await this.persist();
    } catch {
      new Notice('Не удалось сохранить настройки Yandex Disk Sync. Проверьте свободное место.');
    }
  }

  async runSync(): Promise<void> {
    if (this.running || !this.ready) return;
    this.running = true;
    this.settingsTab?.display();
    const notice = new Notice('Яндекс Диск: синхронизация…', 0);

    try {
      await this.saveQueue;
      const settings = { ...this.data.settings, login: this.data.settings.login.trim() };
      if (!settings.login || !settings.password || settings.login.includes(':')) {
        throw new Error('Укажите логин Яндекса и пароль приложения в настройках плагина.');
      }

      const scope = scopeFor(settings);
      if (this.data.state.scope !== scope) this.data.state = emptyState(scope);
      await this.persist();

      const local = new VaultStore(
        this.app.vault,
        `${this.app.vault.configDir}/plugins/${this.manifest.id}/recovery`,
      );
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
      );

      const result = await synchronize(
        local,
        remote,
        this.data.state,
        () => this.persist(),
        (path) => {
          this.status?.setText(`Яндекс Диск: ${path}`);
        },
      );

      this.status?.setText(
        result.errors.length ? 'Яндекс Диск: есть ошибки' : 'Яндекс Диск: готов',
      );
      new Notice(resultText(result), 10000);
      if (result.errors.length || result.conflicts.length || result.skipped.length) {
        new SyncReport(this.app, result).open();
      }
    } catch (error) {
      this.status?.setText('Яндекс Диск: ошибка');
      new Notice(
        `Синхронизация остановлена: ${error instanceof Error ? error.message : 'Неизвестная ошибка.'}`,
        15000,
      );
    } finally {
      notice.hide();
      this.running = false;
      this.settingsTab?.display();
    }
  }

  private persist(): Promise<void> {
    const value: unknown = JSON.parse(JSON.stringify(this.data));
    const save = this.saveQueue.then(() => this.saveData(value));
    this.saveQueue = save.catch(() => {});
    return save;
  }
}
