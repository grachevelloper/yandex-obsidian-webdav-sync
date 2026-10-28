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
      text: 'Заметки и вложения передаются напрямую между этим хранилищем и выбранной папкой Яндекс Диска.',
    });

    new Setting(containerEl).setName('Логин Яндекса').addText((text) =>
      text
        .setValue(this.syncPlugin.data.settings.login)
        .setDisabled(this.syncPlugin.running)
        .onChange((value) => {
          void this.syncPlugin.updateSettings({ login: value });
        }),
    );

    new Setting(containerEl)
      .setName('Пароль приложения')
      .setDesc(
        'Создайте в Яндекс ID пароль типа «Файлы WebDAV». Он хранится локально в data.json плагина открытым текстом; эта папка не синхронизируется плагином.',
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
      .setName('Папка на Яндекс Диске')
      .setDesc(
        'Одинаковая на телефоне и компьютере. Выделите отдельную папку, например Obsidian/Personal.',
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
      .setName('Запустить синхронизацию')
      .setDesc(
        'Удаления не распространяются: отсутствующие файлы восстанавливаются с другой стороны. Конфликтные копии сохраняются рядом с оригиналом.',
      )
      .addButton((button) =>
        button
          .setButtonText(this.syncPlugin.running ? 'Синхронизация…' : 'Синхронизировать')
          .setCta()
          .setDisabled(this.syncPlugin.running)
          .onClick(() => {
            void this.syncPlugin.runSync();
          }),
      );
  }
}
