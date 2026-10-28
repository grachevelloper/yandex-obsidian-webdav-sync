import { Modal, type App } from 'obsidian';
import type { RunLog } from '../logging/log';
import { LogViewer } from './log-viewer';
import { renderReport } from './render-report';

export class SyncReport extends Modal {
  constructor(
    app: App,
    private readonly log: RunLog,
    private readonly logPath: string,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle('Sync report');
    this.modalEl.classList.add('yds-modal');
    renderReport(this.contentEl, this.log, () =>
      new LogViewer(this.app, this.log, this.logPath).open(),
    );
  }

  onClose(): void {
    this.contentEl.replaceChildren();
  }
}
