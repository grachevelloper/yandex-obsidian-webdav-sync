import { t } from '../i18n';

import { ButtonComponent, Modal, ProgressBarComponent, type App } from 'obsidian';
import type { RunLog } from '../logging/log';
import type { SyncProgress } from '../sync/progress';
import type { FileLoader } from '../sync/load-file';
import { FileReviewEditor } from './file-review/editor';
import type { PlanEntry, SyncPlan } from '../sync/types';
import { validateRelocations } from '../sync/relocation';
import type { RetryInfo } from '../webdav/request-scheduler';
import { LogViewer } from './log-viewer';
import { renderPreview, type PreviewListState } from './render-preview';
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
  private splitPreview = false;
  private readonly listState: PreviewListState = { collapsed: new Set(), showUnchanged: false };
  private previewView?: ReturnType<typeof renderPreview>;
  private selectedFile?: PlanEntry;
  private removeAbortListener?: () => void;
  private warning?: string;
  private stopping = false;
  private fileLoader?: FileLoader;
  private restoreCopy?: (path: string, hash: string) => Promise<string>;
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

  setRestoreCopy(restore: (path: string, hash: string) => Promise<string>): void {
    this.restoreCopy = restore;
  }

  confirm(plan: SyncPlan, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false);
    this.mode = 'preview';
    this.plan = plan;
    this.splitPreview =
      !!this.fileLoader &&
      !this.contentEl.ownerDocument.body.classList.contains('is-mobile') &&
      !!this.contentEl.win.matchMedia?.('(min-width: 700px)').matches;
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
    const detail = this.previewView?.detail;
    if (detail && this.selectedFile === entry) {
      detail.focus({ preventScroll: true });
      return;
    }
    if (!this.canLeaveSelectedFile()) return;

    this.fileViewer?.dispose();
    this.conflictEditor?.dispose();
    this.conflictEditor = undefined;
    const back = () => {
      this.fileViewer?.dispose();
      this.fileViewer = undefined;
      this.selectedFile = undefined;
      if (detail) this.renderSelectedFile();
      else {
        this.mode = 'preview';
        this.render();
      }
    };
    const save = detail
      ? () => {
          this.render();
          this.previewView?.detail?.focus({ preventScroll: true });
        }
      : back;
    this.fileViewer = new FileReviewEditor([entry], this.fileLoader, save, back, {
      singleFile: true,
      embedded: !!detail,
      validateRename: (renameTo) => {
        if (!this.plan) return;
        validateRelocations(
          this.plan.entries.map((candidate) =>
            candidate === entry ? { ...entry, renameTo, resolution: undefined } : candidate,
          ),
        );
      },
    });
    if (detail) {
      this.selectedFile = entry;
      this.renderSelectedFile();
      detail.focus({ preventScroll: true });
    } else {
      this.mode = 'file';
      this.render();
    }
  }

  private renderSelectedFile(): void {
    const view = this.previewView;
    const detail = view?.detail;
    if (!view || !detail) return;

    view.selectFile(this.selectedFile);
    if (this.fileViewer) this.fileViewer.show(detail);
    else {
      detail.classList.remove('yds-conflict-editor');
      detail.replaceChildren();
      detail.createEl('p', { cls: 'yds-preview-empty', text: t('Select a file to review it.') });
    }
  }

  private canLeaveSelectedFile(): boolean {
    const detail = this.previewView?.detail;
    if (!detail || !this.fileViewer?.hasUnsavedChanges()) return true;

    let warning = detail.querySelector<HTMLElement>('[data-unsaved-warning]');
    if (!warning) {
      warning = detail.createEl('p', {
        cls: 'yds-preview-warning',
        text: t('Save your choice or close the file to discard your edits.'),
      });
      warning.dataset.unsavedWarning = '';
      warning.setAttribute('role', 'alert');
      warning.tabIndex = -1;
      detail.prepend(warning);
    }
    warning.focus({ preventScroll: true });
    return false;
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
      const scrollTop = this.previewView?.list.scrollTop ?? 0;
      const view = renderPreview(
        this.contentEl,
        plan,
        this.fileLoader ? (entry) => this.openFile(entry) : undefined,
        { split: this.splitPreview, listState: this.listState },
      );
      this.previewView = view;
      new ButtonComponent(view.actions).setButtonText(t('Cancel')).onClick(() => this.close());
      if (!plan.mode || plan.mode === 'two-way') {
        for (const action of ['download', 'upload'] as const) {
          if (!plan.entries.some((entry) => entry.action === action && !entry.resolution)) continue;
          new ButtonComponent(view.actions)
            .setButtonText(
              action === 'download' ? t('Skip remaining downloads') : t('Skip remaining uploads'),
            )
            .onClick(() => {
              if (!this.canLeaveSelectedFile()) return;
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
            if (view.detail) {
              const conflicts = plan.entries.filter((entry) => entry.action === 'conflict');
              const entry = conflicts.find((item) => !item.resolution) ?? conflicts[0];
              if (entry) this.openFile(entry);
              return;
            }
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
          if (!view.canConfirm || !this.decision || !this.canLeaveSelectedFile()) return;
          this.mode = 'progress';
          this.request = undefined;
          this.retry = undefined;
          this.update({ phase: 'sync', processed: 0, total: plan.entries.length, activePaths: [] });
          this.settle(true);
          this.render();
        });
      this.renderSelectedFile();
      view.list.scrollTop = scrollTop;
      return;
    }
    if (this.mode === 'report') {
      this.setTitle(t('Sync report'));
      renderReport(
        this.contentEl,
        this.log,
        () => new LogViewer(this.app, this.log, this.logPath).open(),
        this.progress,
        this.restoreCopy,
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
    this.previewView = undefined;
    this.selectedFile = undefined;
    this.listState.collapsed.clear();
    this.listState.showUnchanged = false;
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
