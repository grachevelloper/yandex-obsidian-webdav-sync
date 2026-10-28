import { App, Modal } from 'obsidian';
import type { SyncResult } from '../sync/engine';

export function resultText(result: SyncResult): string {
  return `Загружено: ${result.uploaded}, скачано: ${result.downloaded}, конфликтов: ${result.conflicts.length}, пропущено: ${result.skipped.length}, ошибок: ${result.errors.length}.`;
}

export class SyncReport extends Modal {
  constructor(
    app: App,
    private readonly result: SyncResult,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle('Результат синхронизации');
    this.contentEl.createEl('p', { text: resultText(this.result) });

    for (const [title, entries] of [
      ['Конфликты — обе версии сохранены', this.result.conflicts],
      ['Пропущены файлы больше 50 МиБ', this.result.skipped],
      ['Ошибки — повторите запуск после устранения причины', this.result.errors],
    ] as const) {
      if (entries.length === 0) continue;
      this.contentEl.createEl('h3', { text: title });
      const list = this.contentEl.createEl('ul');
      for (const entry of entries) list.createEl('li', { text: entry });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
