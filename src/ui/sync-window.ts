import { t } from '../i18n';

import { ButtonComponent, Modal, ProgressBarComponent, type App } from 'obsidian';
import type { RunLog } from '../logging/log';
import type { SyncProgress } from '../sync/progress';
import type { FileLoader } from '../sync/load-file';
import { FileReviewEditor } from './file-review/editor';
import type { PlanEntry, SyncPlan } from '../sync/types';
import type { RetryInfo } from '../webdav/request-scheduler';
import { LogViewer } from './log-viewer';
import { renderPreview } from './render-preview';
import { renderProgress } from './render-progress';
import { renderReport } from './render-report';

export class SyncWindow extends Modal {
  private visible = false;
  private mode: 'progress' | 'preview' | 'conflict' | 'file' | 'report' = 'progress';
  private progress: SyncProgress = { phase: 'listing', processed: 0, activePaths: [] };
  private view?: ReturnType<typeof renderProgress>;
  private bar?: ProgressBarComponent;
  private timer?: number;
  private phaseStartedAt = Date.now();
  private request?: { method: string; path: string };
  private retry?: { reason: RetryInfo['reason']; until: number };
  private decision?: (confirmed: boolean) => void;
  private plan?: SyncPlan;
  private removeAbortListener?: () => void;
  private warning?: string;
  private stopping = false;
  private fileLoader?: FileLoader;
  private conflictEditor?: FileReviewEditor;
  private fileViewer?: FileReviewEditor;

  constructor(
    app: App,
    private readonly log: RunLog,
    private readonly logPath: string,
    private readonly stopSync?: () => void,
  ) {
    super(app);
  }

  show(): void {
    if (!this.visible) {
      this.open();
      // Obsidian focuses the first button after onOpen; restore focus to progress instead.
      this.view?.bar.focus({ preventScroll: true });
    }
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

  setFileLoader(load: FileLoader): void {
    this.fileLoader = load;
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

  private openFile(entry: PlanEntry): void {
    if (!this.fileLoader) return;
    const back = () => {
      this.fileViewer?.dispose();
      this.fileViewer = undefined;
      this.conflictEditor?.dispose();
      this.conflictEditor = undefined;
      this.mode = 'preview';
      this.render();
    };
    this.fileViewer = new FileReviewEditor([entry], this.fileLoader, back, back, {
      singleFile: true,
    });
    this.mode = 'file';
    this.render();
  }

  private render(): void {
    this.clearProgress();
    this.modalEl.classList.toggle(
      'yds-conflict-modal',
      this.mode === 'conflict' || this.mode === 'file',
    );
    this.contentEl.classList.remove(
      'yds-preview',
      'yds-progress',
      'yds-report',
      'yds-conflict-editor',
    );
    if (this.mode === 'file') {
      this.setTitle(t('Review file'));
      this.fileViewer?.show(this.contentEl);
      return;
    }
    if (this.mode === 'conflict') {
      this.setTitle(t('Resolve conflicts'));
      this.conflictEditor?.show(this.contentEl);
      return;
    }
    if (this.mode === 'preview') {
      this.setTitle(t('Sync preview'));
      const plan = this.plan;
      if (!plan) return;
      const view = renderPreview(
        this.contentEl,
        plan,
        this.fileLoader ? (entry) => this.openFile(entry) : undefined,
      );
      new ButtonComponent(view.actions).setButtonText(t('Cancel')).onClick(() => this.close());
      if (!plan.mode || plan.mode === 'two-way') {
        for (const action of ['download', 'upload'] as const) {
          if (!plan.entries.some((entry) => entry.action === action && !entry.resolution)) continue;
          new ButtonComponent(view.actions)
            .setButtonText(
              action === 'download' ? t('Skip remaining downloads') : t('Skip remaining uploads'),
            )
            .onClick(() => {
              for (const entry of plan.entries) {
                if (entry.action === action && !entry.resolution)
                  entry.resolution = { kind: 'skip' };
              }
              this.render();
            });
        }
      }

      if (plan.entries.some((entry) => entry.action === 'conflict') && this.fileLoader) {
        new ButtonComponent(view.actions)
          .setButtonText(
            view.unresolved
              ? t('Resolve conflicts (') + view.unresolved + ')'
              : t('Edit resolutions'),
          )
          .onClick(() => {
            if (!this.conflictEditor && this.fileLoader) {
              this.conflictEditor = new FileReviewEditor(
                plan.entries,
                this.fileLoader,
                () => {
                  this.mode = 'preview';
                  this.render();
                },
                () => this.close(),
              );
            }
            this.mode = 'conflict';
            this.render();
          });
      }

      new ButtonComponent(view.actions)
        .setButtonText(view.changes ? t('Confirm sync') : t('Finish check'))
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
      this.setTitle(t('Sync report'));
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

    this.setTitle(this.progress.phase === 'sync' ? t('Syncing files') : t('Checking files'));
    this.view = renderProgress(this.contentEl);
    this.bar = new ProgressBarComponent(this.view.bar);
    new ButtonComponent(this.view.actions)
      .setButtonText(t('Hide window'))
      .onClick(() => this.close());
    if (this.stopSync) {
      const button = new ButtonComponent(this.view.actions)
        .setButtonText(this.stopping ? t('Stopping…') : t('Stop sync'))
        .setDisabled(this.stopping)
        .onClick(() => {
          if (this.stopping) return;
          this.stopping = true;
          button.setButtonText(t('Stopping…')).setDisabled(true);
          this.stopSync?.();
          this.renderActivity();
        });
    }
    this.update(this.progress);
    this.view.bar.focus({ preventScroll: true });
    this.timer = this.contentEl.win.setInterval(() => this.renderActivity(), 1000);
  }

  private renderActivity(): void {
    if (!this.view) return;
    const seconds = Math.max(0, Math.floor((Date.now() - this.phaseStartedAt) / 1000));
    this.view.elapsed.textContent = t('Elapsed: {0}m {1}s', {
      '0': Math.floor(seconds / 60),
      '1': seconds % 60,
    });
    if (this.stopping) {
      this.view.activity.textContent = t(
        'Stopping… Waiting for in-flight requests; completed changes are kept.',
      );
      return;
    }
    const wait = this.retry ? Math.max(0, Math.ceil((this.retry.until - Date.now()) / 1000)) : 0;
    if (this.retry && wait) {
      this.view.activity.textContent = t('{0}. Retrying in {1}s…', {
        '0':
          this.retry.reason === 'rate-limit'
            ? t('Yandex Disk requested a pause')
            : t('Connection interrupted'),
        '1': wait,
      });
    } else if (
      this.progress.total !== undefined &&
      this.progress.processed === this.progress.total
    ) {
      this.view.activity.textContent =
        this.progress.phase === 'sync' ? t('Saving the sync report…') : t('Preparing the preview…');
    } else if (this.request) {
      const verbs: Record<string, string> = {
        GET: t('Reading file'),
        PUT: t('Uploading file'),
        PROPFIND: t('Reading folder'),
        MKCOL: t('Creating folder'),
      };
      this.view.activity.textContent = `${verbs[this.request.method] ?? t('Processing')}: ${this.request.path}`;
    } else this.view.activity.textContent = t('Preparing files…');
  }

  private settle(confirmed: boolean): void {
    const decide = this.decision;
    this.decision = undefined;
    this.plan = undefined;
    this.conflictEditor?.dispose();
    this.conflictEditor = undefined;
    this.fileViewer?.dispose();
    this.fileViewer = undefined;
    this.removeAbortListener?.();
    this.removeAbortListener = undefined;
    decide?.(confirmed);
  }

  private clearProgress(): void {
    if (this.timer !== undefined) this.contentEl.win.clearInterval(this.timer);
    this.timer = undefined;
    this.view = undefined;
    this.bar = undefined;
  }
}
