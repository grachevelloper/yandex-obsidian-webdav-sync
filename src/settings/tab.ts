import { t, isLanguagePreference } from '../i18n';
import { PluginSettingTab, Setting } from 'obsidian';

import { isRequestIntervalMs, MAX_CONCURRENT_REQUESTS } from '../shared/transfer-limits';
import type WebDavSync from '../main';

export class SyncSettingsTab extends PluginSettingTab {
  private readonly syncControls: ((busy: boolean) => void)[] = [];
  private updateConnection?: () => void;
  private updateSyncButton?: () => void;

  constructor(private readonly syncPlugin: WebDavSync) {
    super(syncPlugin.app, syncPlugin);
  }

  refreshActivity(): void {
    const busy = this.syncPlugin.running || this.syncPlugin.checkingConnection;
    for (const update of this.syncControls) update(busy);
    this.updateConnection?.();
    this.updateSyncButton?.();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    this.syncControls.length = 0;
    new Setting(containerEl)
      .setName(t('Language'))
      .setDesc(
        t('Choose the plugin language. Saved diagnostic logs keep the language of their run.'),
      )
      .addDropdown((dropdown) => {
        this.syncControls.push((busy) => dropdown.setDisabled(busy));
        dropdown
          .addOption('ru', 'Русский')
          .addOption('en', 'English')
          .addOption('auto', t('Follow Obsidian'))
          .setValue(this.syncPlugin.data.settings.language)
          .onChange((value) => {
            if (isLanguagePreference(value))
              void this.syncPlugin.updateSettings({ language: value });
          });
      });

    containerEl.createEl('p', {
      text: t(
        'Sync notes and attachments directly between this vault and a dedicated Yandex Disk folder.',
      ),
    });

    new Setting(containerEl).setName(t('Yandex login')).addText((text) => {
      this.syncControls.push((busy) => text.setDisabled(busy));
      text.setValue(this.syncPlugin.data.settings.login).onChange((value) => {
        void this.syncPlugin.updateSettings({ login: value });
      });
    });

    new Setting(containerEl)
      .setName(t('App password'))
      .setDesc(
        t(
          'Create a Files WebDAV app password in Yandex ID. It is stored as plain text in the local plugin data.json; this folder is excluded from sync.',
        ),
      )
      .addText((text) => {
        this.syncControls.push((busy) => text.setDisabled(busy));
        text.inputEl.type = 'password';
        text.inputEl.autocomplete = 'off';
        text.setValue(this.syncPlugin.data.settings.password).onChange((value) => {
          void this.syncPlugin.updateSettings({ password: value });
        });
      });

    new Setting(containerEl)
      .setName(t('Yandex Disk folder'))
      .setDesc(
        t(
          'Use the same dedicated folder on your phone and computer, for example Obsidian/Personal.',
        ),
      )
      .addText((text) => {
        this.syncControls.push((busy) => text.setDisabled(busy));
        text.setValue(this.syncPlugin.data.settings.folder).onChange((value) => {
          void this.syncPlugin.updateSettings({ folder: value });
        });
      });

    new Setting(containerEl)
      .setName(t('Concurrent requests'))
      .setDesc(
        t(
          'Maximum requests running at once, from 1 to 8. Applies to preview and confirmed sync. Higher values use more memory.',
        ),
      )
      .addDropdown((dropdown) => {
        this.syncControls.push((busy) => dropdown.setDisabled(busy));
        for (let value = 1; value <= MAX_CONCURRENT_REQUESTS; value++)
          dropdown.addOption(String(value), String(value));
        dropdown
          .setValue(String(this.syncPlugin.data.settings.concurrentRequests))
          .onChange((value) => {
            void this.syncPlugin.updateSettings({ concurrentRequests: Number(value) });
          });
      });

    new Setting(containerEl)
      .setName(t('Request start interval (seconds)'))
      .setDesc(
        t(
          'Minimum time between starting requests, even when they overlap. From 0.1 to 60 seconds; default 1. Server cooldowns can make the wait longer.',
        ),
      )
      .addText((text) => {
        this.syncControls.push((busy) => text.setDisabled(busy));
        text.inputEl.type = 'number';
        text.inputEl.min = '0.1';
        text.inputEl.max = '60';
        text.inputEl.step = '0.001';
        text
          .setValue(String(this.syncPlugin.data.settings.requestIntervalMs / 1000))
          .onChange((value) => {
            const milliseconds = Math.round(Number(value) * 1000);
            if (isRequestIntervalMs(milliseconds))
              void this.syncPlugin.updateSettings({ requestIntervalMs: milliseconds });
          });
        text.inputEl.addEventListener('blur', () =>
          text.setValue(String(this.syncPlugin.data.settings.requestIntervalMs / 1000)),
        );
      });

    const connection = new Setting(containerEl).setName(t('Connection'));
    connection.addButton((button) => {
      this.syncControls.push((busy) => button.setDisabled(busy));
      this.updateConnection = () => {
        connection.setDesc(
          this.syncPlugin.connectionResult ??
            t(
              'Check login, app password and folder access without scanning or transferring notes.',
            ),
        );
        button.setButtonText(
          this.syncPlugin.checkingConnection ? t('Checking…') : t('Test connection'),
        );
      };
      button.onClick(() => {
        void this.syncPlugin.testConnection();
      });
    });

    new Setting(containerEl)
      .setName(t('Run sync'))
      .setDesc(
        t(
          'Choose two-way sync or an exact-copy direction at launch. Review transfers, conflicts and any mirror deletions before confirming.',
        ),
      )
      .addButton((button) => {
        this.updateSyncButton = () => {
          button
            .setButtonText(this.syncPlugin.running ? t('View progress') : t('Preview sync'))
            .setDisabled(this.syncPlugin.checkingConnection);
        };
        button.setCta().onClick(() => {
          void this.syncPlugin.runSync();
        });
      });

    new Setting(containerEl)
      .setName(t('Local sync logs'))
      .setDesc(
        t(
          'Review the latest run, including errors and HTTP statuses. Logs stay on this device; the last 10 runs are retained.',
        ),
      )
      .addButton((button) =>
        button.setButtonText(t('View latest log')).onClick(() => {
          void this.syncPlugin.openLatestLog();
        }),
      );

    this.refreshActivity();
  }
}
