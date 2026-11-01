import { ButtonComponent, Modal, ProgressBarComponent, type App } from 'obsidian';
import type { RunLog } from '../logging/log';
import type { SyncProgress } from '../sync/progress';
import type { SyncPlan } from '../sync/types';
import type { RetryInfo } from '../webdav/request-scheduler';
import { LogViewer } from './log-viewer';
import { renderPreview } from './render-preview';
import { renderProgress } from './render-progress';
import { renderReport } from './render-report';

export class SyncWindow extends Modal {
  private visible = false;
  private mode: 'progress' | 'preview' | 'report' = 'progress';
  private progress: SyncProgress = { phase: 'listing', processed: 0, activePaths: [] };
  private view?: ReturnType<typeof renderProgress>;
  private bar?: ProgressBarComponent;
  private timer?: ReturnType<typeof setInterval>;
  private phaseStartedAt = Date.now();
  private request?: { method: string; path: string };
  private retry?: { reason: RetryInfo['reason']; until: number };
  private decision?: (confirmed: boolean) => void;
  private plan?: SyncPlan;
  private removeAbortListener?: () => void;
  private warning?: string;

  constructor(
    app: App,
    private readonly log: RunLog,
    private readonly logPath: string,
  ) {
    super(app);
  }

  show(): void {
    if (!this.visible) this.open();
  }

  update(value: SyncProgress): void {
    if (value.phase === 'sync' && this.progress.phase !== 'sync') this.phaseStartedAt = Date.now();
    this.progress = value;
    this.view?.update(value);
    this.bar?.setValue(this.view?.percent() ?? 0);
    this.renderActivity();
  }

  requestStarted(method: string, path: string): void {
    this.request = { method, path };
    this.retry = undefined;
    this.renderActivity();
  }

  waiting(retry: RetryInfo): void {
    this.retry = { reason: retry.reason, until: Date.now() + retry.delayMs };
    this.renderActivity();
  }

  confirm(plan: SyncPlan, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false);
    this.mode = 'preview';
    this.plan = plan;
    return new Promise((resolve) => {
      this.decision = resolve;
      const abort = () => this.close();
      signal.addEventListener('abort', abort, { once: true });
      this.removeAbortListener = () => signal.removeEventListener('abort', abort);
      if (this.visible) this.render();
      else this.show();
    });
  }

  finish(warning?: string): void {
    this.settle(false);
    this.mode = 'report';
    this.warning = warning;
    if (this.visible) this.render();
  }

  onOpen(): void {
    this.visible = true;
    this.modalEl.classList.add('yds-preview-modal', 'yds-sync-modal');
    this.render();
  }

  onClose(): void {
    this.visible = false;
    if (this.decision) {
      this.mode = 'progress';
      this.settle(false);
    }
    this.clearProgress();
    this.contentEl.replaceChildren();
  }

  private render(): void {
    this.clearProgress();
    this.contentEl.classList.remove('yds-preview', 'yds-progress', 'yds-report');
    if (this.mode === 'preview') {
      this.setTitle('Sync preview');
      const plan = this.plan;
      if (!plan) return;
      const view = renderPreview(this.contentEl, plan);
      new ButtonComponent(view.actions).setButtonText('Cancel').onClick(() => this.close());
      new ButtonComponent(view.actions)
        .setButtonText(view.changes ? 'Confirm sync' : 'Finish check')
        .setCta()
        .setDisabled(!view.canConfirm)
        .onClick(() => {
          if (!view.canConfirm || !this.decision) return;
          this.mode = 'progress';
          this.request = undefined;
          this.retry = undefined;
          this.update({ phase: 'sync', processed: 0, total: plan.entries.length, activePaths: [] });
          this.settle(true);
          this.render();
        });
      return;
    }
    if (this.mode === 'report') {
      this.setTitle('Sync report');
      renderReport(
        this.contentEl,
        this.log,
        () => new LogViewer(this.app, this.log, this.logPath).open(),
        this.progress,
      );
      if (this.warning)
        this.contentEl.createEl('p', { cls: 'yds-preview-warning', text: this.warning });
      return;
    }

    this.setTitle(this.progress.phase === 'sync' ? 'Syncing files' : 'Checking files');
    this.view = renderProgress(this.contentEl);
    this.bar = new ProgressBarComponent(this.view.bar);
    new ButtonComponent(this.view.actions).setButtonText('Hide window').onClick(() => this.close());
    this.update(this.progress);
    this.timer = setInterval(() => this.renderActivity(), 1000);
  }

  private renderActivity(): void {
    if (!this.view) return;
    const seconds = Math.max(0, Math.floor((Date.now() - this.phaseStartedAt) / 1000));
    this.view.elapsed.textContent = `Elapsed: ${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    const wait = this.retry ? Math.max(0, Math.ceil((this.retry.until - Date.now()) / 1000)) : 0;
    if (this.retry && wait) {
      this.view.activity.textContent = `${this.retry.reason === 'rate-limit' ? 'Yandex Disk requested a pause' : 'Connection interrupted'}. Retrying in ${wait}s…`;
    } else if (
      this.progress.total !== undefined &&
      this.progress.processed === this.progress.total
    ) {
      this.view.activity.textContent =
        this.progress.phase === 'sync' ? 'Saving the sync report…' : 'Preparing the preview…';
    } else if (this.request) {
      const verbs: Record<string, string> = {
        GET: 'Reading file',
        PUT: 'Uploading file',
        PROPFIND: 'Reading folder',
        MKCOL: 'Creating folder',
      };
      this.view.activity.textContent = `${verbs[this.request.method] ?? 'Processing'}: ${this.request.path}`;
    } else this.view.activity.textContent = 'Preparing files…';
  }

  private settle(confirmed: boolean): void {
    const decide = this.decision;
    this.decision = undefined;
    this.plan = undefined;
    this.removeAbortListener?.();
    this.removeAbortListener = undefined;
    decide?.(confirmed);
  }

  private clearProgress(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.view = undefined;
    this.bar = undefined;
  }
}
