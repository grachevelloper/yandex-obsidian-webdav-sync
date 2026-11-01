import { PluginSettingTab, Setting } from 'obsidian';
import { isRequestIntervalMs, MAX_CONCURRENT_REQUESTS } from '../shared/transfer-limits';
import type WebDavSync from '../main';

export class SyncSettingsTab extends PluginSettingTab {
  constructor(private readonly syncPlugin: WebDavSync) {
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
      .setName('Concurrent requests')
      .setDesc(
        'Maximum requests running at once, from 1 to 8. Applies to preview and confirmed sync. Higher values use more memory.',
      )
      .addDropdown((dropdown) => {
        for (let value = 1; value <= MAX_CONCURRENT_REQUESTS; value++)
          dropdown.addOption(String(value), String(value));
        dropdown
          .setValue(String(this.syncPlugin.data.settings.concurrentRequests))
          .setDisabled(this.syncPlugin.running)
          .onChange((value) => {
            void this.syncPlugin.updateSettings({ concurrentRequests: Number(value) });
          });
      });

    new Setting(containerEl)
      .setName('Request start interval (seconds)')
      .setDesc(
        'Minimum time between starting requests, even when they overlap. From 0.1 to 60 seconds; default 1. Server cooldowns can make the wait longer.',
      )
      .addText((text) => {
        text.inputEl.type = 'number';
        text.inputEl.min = '0.1';
        text.inputEl.max = '60';
        text.inputEl.step = '0.001';
        text
          .setValue(String(this.syncPlugin.data.settings.requestIntervalMs / 1000))
          .setDisabled(this.syncPlugin.running)
          .onChange((value) => {
            const milliseconds = Math.round(Number(value) * 1000);
            if (isRequestIntervalMs(milliseconds))
              void this.syncPlugin.updateSettings({ requestIntervalMs: milliseconds });
          });
        text.inputEl.addEventListener('blur', () =>
          text.setValue(String(this.syncPlugin.data.settings.requestIntervalMs / 1000)),
        );
      });

    new Setting(containerEl)
      .setName('Run sync')
      .setDesc(
        'Review uploads, downloads and conflicts before confirming any transfers. Missing files are restored; no deletions are propagated.',
      )
      .addButton((button) =>
        button
          .setButtonText(this.syncPlugin.running ? 'Syncing…' : 'Preview sync')
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
