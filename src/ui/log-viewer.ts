import { t } from '../i18n';
import { Modal, type App } from 'obsidian';
import type { RunLog } from '../logging/log';

export class LogViewer extends Modal {
  constructor(
    app: App,
    private readonly log: RunLog,
    private readonly path: string,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(t('Sync log'));
    this.modalEl.classList.add('yds-modal');
    this.contentEl.createEl('p', {
      text: t(
        'Stored only on this device. Includes file paths and HTTP statuses; no passwords, authorization headers or file contents.',
      ),
    });
    this.contentEl.createEl('code', { text: this.path, cls: 'yds-path' });
    this.contentEl.createEl('pre', { text: JSON.stringify(this.log, null, 2), cls: 'yds-log' });
  }

  onClose(): void {
    this.contentEl.replaceChildren();
  }
}
