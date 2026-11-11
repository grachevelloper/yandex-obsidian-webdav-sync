import { t, isLanguagePreference, type MessageKey } from '../i18n';
import { PluginSettingTab, requireApiVersion, Setting } from 'obsidian';

import { isRequestIntervalMs, MAX_CONCURRENT_REQUESTS } from '../shared/transfer-limits';
import type WebDavSync from '../main';

const connectionTitles = {
  success: 'Connected',
  warning: 'Folder not found',
  error: 'Connection failed',
} satisfies Record<string, MessageKey>;

export class SyncSettingsTab extends PluginSettingTab {
  private readonly activityUpdates = new Set<() => void>();

  constructor(private readonly syncPlugin: WebDavSync) {
    super(syncPlugin.app, syncPlugin);
  }

  private get busy(): boolean {
    return this.syncPlugin.running || this.syncPlugin.checkingConnection;
  }

  refreshActivity(): void {
    for (const update of this.activityUpdates) update();
  }

  refresh(): void {
    if (requireApiVersion('1.13.0')) this.update();
    else this.renderLegacy();
  }

  display(): void {
    this.renderLegacy();
  }

  hide(): void {
    super.hide();
    this.activityUpdates.clear();
  }

  private watchActivity(update: () => void): () => void {
    this.activityUpdates.add(update);
    update();
    return () => {
      this.activityUpdates.delete(update);
    };
  }

  private renderLegacy(): void {
    this.activityUpdates.clear();
    this.containerEl.empty();
    for (const definition of this.getSettingDefinitions()) {
      const setting = new Setting(this.containerEl).setName(definition.name);
      if (definition.desc) setting.setDesc(definition.desc);
      definition.render(setting);
    }
  }

  getSettingDefinitions() {
    return [
      {
        name: t('Language'),
        desc: t(
          'Choose the plugin language. Saved diagnostic logs keep the language of their run.',
        ),
        render: (setting: Setting) => {
          let cleanup = () => {};
          setting.addDropdown((dropdown) => {
            dropdown
              .addOption('ru', 'Русский')
              .addOption('en', 'English')
              .addOption('auto', t('Follow Obsidian'))
              .setValue(this.syncPlugin.data.settings.language)
              .onChange((value) => {
                if (isLanguagePreference(value))
                  void this.syncPlugin.updateSettings({ language: value });
              });
            cleanup = this.watchActivity(() => {
              dropdown.setDisabled(this.busy);
            });
          });
          return cleanup;
        },
      },
      {
        name: t(
          'Sync notes and attachments directly between this vault and a dedicated Yandex Disk folder.',
        ),
        searchable: false,
        render: (setting: Setting) => {
          const paragraph = setting.settingEl.createEl('p', {
            text: setting.nameEl.textContent ?? '',
          });
          setting.settingEl.replaceWith(paragraph);
        },
      },
      {
        name: t('Yandex login'),
        render: (setting: Setting) => {
          let cleanup = () => {};
          setting.addText((text) => {
            text.setValue(this.syncPlugin.data.settings.login).onChange((value) => {
              void this.syncPlugin.updateSettings({ login: value });
            });
            cleanup = this.watchActivity(() => {
              text.setDisabled(this.busy);
            });
          });
          return cleanup;
        },
      },
      {
        name: t('App password'),
        desc: t(
          'Create a Files WebDAV app password in Yandex ID. It is stored as plain text in the local plugin data.json; this folder is excluded from sync.',
        ),
        render: (setting: Setting) => {
          let cleanup = () => {};
          setting.addText((text) => {
            text.inputEl.type = 'password';
            text.inputEl.autocomplete = 'off';
            text.setValue(this.syncPlugin.data.settings.password).onChange((value) => {
              void this.syncPlugin.updateSettings({ password: value });
            });
            cleanup = this.watchActivity(() => {
              text.setDisabled(this.busy);
            });
          });
          return cleanup;
        },
      },
      {
        name: t('Yandex Disk folder'),
        desc: t(
          'Use the same dedicated folder on your phone and computer, for example Obsidian/Personal.',
        ),
        render: (setting: Setting) => {
          let cleanup = () => {};
          setting.addText((text) => {
            text.setValue(this.syncPlugin.data.settings.folder).onChange((value) => {
              void this.syncPlugin.updateSettings({ folder: value });
            });
            cleanup = this.watchActivity(() => {
              text.setDisabled(this.busy);
            });
          });
          return cleanup;
        },
      },
      {
        name: t('Concurrent requests'),
        desc: t(
          'Maximum requests running at once, from 1 to {0}. Applies to preview and confirmed sync. Higher values use more memory.',
          { '0': MAX_CONCURRENT_REQUESTS },
        ),
        render: (setting: Setting) => {
          let cleanup = () => {};
          setting.addDropdown((dropdown) => {
            for (let value = 1; value <= MAX_CONCURRENT_REQUESTS; value++)
              dropdown.addOption(String(value), String(value));
            dropdown
              .setValue(String(this.syncPlugin.data.settings.concurrentRequests))
              .onChange((value) => {
                void this.syncPlugin.updateSettings({ concurrentRequests: Number(value) });
              });
            cleanup = this.watchActivity(() => {
              dropdown.setDisabled(this.busy);
            });
          });
          return cleanup;
        },
      },
      {
        name: t('Request start interval (seconds)'),
        desc: t(
          'Minimum time between starting requests, even when they overlap. From 0.1 to 60 seconds; default 1. Server cooldowns can make the wait longer.',
        ),
        render: (setting: Setting) => {
          let cleanup = () => {};
          setting.addText((text) => {
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
            text.inputEl.addEventListener('blur', () => {
              text.setValue(String(this.syncPlugin.data.settings.requestIntervalMs / 1000));
            });
            cleanup = this.watchActivity(() => {
              text.setDisabled(this.busy);
            });
          });
          return cleanup;
        },
      },
      {
        name: t('Connection'),
        desc: t(
          'Check login, app password and folder access without scanning or transferring notes.',
        ),
        render: (setting: Setting) => {
          const status = setting.descEl.createDiv();
          status.setAttribute('role', 'status');
          let cleanup = () => {};
          setting.addButton((button) => {
            button.onClick(() => {
              void this.syncPlugin.testConnection();
            });
            cleanup = this.watchActivity(() => {
              status.replaceChildren();
              const result = this.syncPlugin.connectionResult;
              if (this.syncPlugin.checkingConnection) {
                status.createDiv({
                  cls: 'yds-connection-message',
                  text: t('Checking connection…'),
                });
              } else if (result) {
                const message = status.createDiv({
                  cls: ['yds-connection-message', `yds-connection-${result.kind}`],
                });
                message.createEl('strong', { text: t(connectionTitles[result.kind]) });
                message.createDiv({ text: result.message });
              }

              button
                .setDisabled(this.busy)
                .setButtonText(
                  this.syncPlugin.checkingConnection ? t('Checking…') : t('Test connection'),
                );
            });
          });
          return cleanup;
        },
      },
      {
        name: t('Run sync'),
        desc: t(
          'Choose two-way sync or an exact-copy direction at launch. Review transfers, conflicts and any mirror deletions before confirming.',
        ),
        render: (setting: Setting) => {
          let cleanup = () => {};
          setting.addButton((button) => {
            button.setCta().onClick(() => {
              void this.syncPlugin.runSync();
            });
            cleanup = this.watchActivity(() => {
              button
                .setButtonText(this.syncPlugin.running ? t('View progress') : t('Preview sync'))
                .setDisabled(this.syncPlugin.checkingConnection);
            });
          });
          return cleanup;
        },
      },
      {
        name: t('Local sync logs'),
        desc: t(
          'Review the latest run, including errors and HTTP statuses. Logs stay on this device; the last 10 runs are retained.',
        ),
        render: (setting: Setting) => {
          setting.addButton((button) => {
            button.setButtonText(t('View latest log')).onClick(() => {
              void this.syncPlugin.openLatestLog();
            });
          });
        },
      },
    ];
  }
}
