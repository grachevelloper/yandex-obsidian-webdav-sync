import { PluginSettingTab, Setting } from 'obsidian';
import type YandexDiskSync from '../main';

export class SyncSettingsTab extends PluginSettingTab {
  constructor(private readonly syncPlugin: YandexDiskSync) {
    super(syncPlugin.app, syncPlugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('p', {
      text: 'Sync notes and attachments directly between this vault and a dedicated Yandex Disk folder.',
    });

    new Setting(containerEl).setName('Yandex login').addText((text) =>
      text
        .setValue(this.syncPlugin.data.settings.login)
        .setDisabled(this.syncPlugin.running)
        .onChange((value) => {
          void this.syncPlugin.updateSettings({ login: value });
        }),
    );

    new Setting(containerEl)
      .setName('App password')
      .setDesc(
        'Create a Files WebDAV app password in Yandex ID. It is stored as plain text in the local plugin data.json; this folder is excluded from sync.',
      )
      .addText((text) => {
        text.inputEl.type = 'password';
        text.inputEl.autocomplete = 'off';
        text
          .setValue(this.syncPlugin.data.settings.password)
          .setDisabled(this.syncPlugin.running)
          .onChange((value) => {
            void this.syncPlugin.updateSettings({ password: value });
          });
      });

    new Setting(containerEl)
      .setName('Yandex Disk folder')
      .setDesc(
        'Use the same dedicated folder on your phone and computer, for example Obsidian/Personal.',
      )
      .addText((text) =>
        text
          .setValue(this.syncPlugin.data.settings.folder)
          .setDisabled(this.syncPlugin.running)
          .onChange((value) => {
            void this.syncPlugin.updateSettings({ folder: value });
          }),
      );

    new Setting(containerEl)
      .setName('Run sync')
      .setDesc(
        'Missing files are restored from the other side. Both conflicting versions are preserved beside the original.',
      )
      .addButton((button) =>
        button
          .setButtonText(this.syncPlugin.running ? 'Syncing…' : 'Sync now')
          .setCta()
          .setDisabled(this.syncPlugin.running)
          .onClick(() => {
            void this.syncPlugin.runSync();
          }),
      );

    new Setting(containerEl)
      .setName('Local sync logs')
      .setDesc(
        'Review the latest run, including errors and HTTP statuses. Logs stay on this device; the last 10 runs are retained.',
      )
      .addButton((button) =>
        button.setButtonText('View latest log').onClick(() => {
          void this.syncPlugin.openLatestLog();
        }),
      );
  }
}
