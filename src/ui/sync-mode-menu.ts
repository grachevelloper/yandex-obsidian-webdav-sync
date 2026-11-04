import { t } from '../i18n';
import { Modal, type App } from 'obsidian';
import type { SyncMode } from '../sync/types';

export class SyncModeMenu extends Modal {
  private decide?: (mode: SyncMode | undefined) => void;
  private removeAbortListener?: () => void;

  constructor(app: App) {
    super(app);
  }

  choose(signal: AbortSignal): Promise<SyncMode | undefined> {
    if (signal.aborted) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      this.decide = resolve;
      const abort = () => this.close();
      signal.addEventListener('abort', abort, { once: true });
      this.removeAbortListener = () => signal.removeEventListener('abort', abort);
      this.open();
    });
  }

  onOpen(): void {
    this.setTitle(t('Start sync'));
    this.modalEl.classList.add('yds-mode-modal');
    this.contentEl.classList.add('yds-mode-menu');
    const options: { mode: SyncMode; label: string; description: string }[] = [
      {
        mode: 'two-way',
        label: t('Two-way sync'),
        description: t(
          'Exchange changes on both sides. Review conflicts and any manually marked deletions.',
        ),
      },
      {
        mode: 'device-wins',
        label: t('Device → Disk · exact copy'),
        description: t(
          'Replace cloud differences and delete Disk-only files. Reviewed files may also update this device.',
        ),
      },
      {
        mode: 'cloud-wins',
        label: t('Disk → device · exact copy'),
        description: t(
          'Replace local differences and delete device-only files. Reviewed files may also update Disk.',
        ),
      },
    ];
    const document = this.contentEl.ownerDocument;
    for (const option of options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'yds-mode-option';
      button.dataset.syncMode = option.mode;
      const label = document.createElement('strong');
      label.textContent = option.label;
      const description = document.createElement('span');
      description.textContent = option.description;
      button.append(label, description);
      button.addEventListener('click', () => {
        this.settle(option.mode);
        this.close();
      });
      this.contentEl.append(button);
    }
    this.contentEl.createEl('p', {
      cls: 'yds-mode-hint',
      text: t('Next: review the preview. No files change until you confirm.'),
    });
  }

  onClose(): void {
    this.settle(undefined);
    this.contentEl.replaceChildren();
  }

  private settle(mode: SyncMode | undefined): void {
    const decide = this.decide;
    this.decide = undefined;
    this.removeAbortListener?.();
    this.removeAbortListener = undefined;
    decide?.(mode);
  }
}
