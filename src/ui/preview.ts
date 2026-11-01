import { ButtonComponent, Modal, type App } from 'obsidian';
import type { SyncPlan } from '../sync/types';
import { renderPreview } from './render-preview';

export function confirmSyncPlan(app: App, plan: SyncPlan, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const modal = new PreviewModal(app, plan, (confirmed) => {
      signal.removeEventListener('abort', cancel);
      resolve(confirmed);
    });
    const cancel = () => modal.close();
    signal.addEventListener('abort', cancel, { once: true });
    modal.open();
  });
}

class PreviewModal extends Modal {
  constructor(
    app: App,
    private readonly plan: SyncPlan,
    private readonly decide: (confirmed: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle('Sync preview');
    this.modalEl.classList.add('yds-preview-modal');
    const view = renderPreview(this.contentEl, this.plan);
    new ButtonComponent(view.actions).setButtonText('Cancel').onClick(() => this.close());
    new ButtonComponent(view.actions)
      .setButtonText(view.changes ? 'Confirm sync' : 'Finish check')
      .setCta()
      .setDisabled(!view.canConfirm)
      .onClick(() => {
        this.decide(true);
        this.close();
      });
  }

  onClose(): void {
    this.decide(false);
    this.contentEl.replaceChildren();
  }
}
