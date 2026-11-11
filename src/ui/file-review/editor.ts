import { t } from '../../i18n';
import { attachmentPreview, type AttachmentPreview } from './attachment';
import { editableText, useBothVersions } from '../../sync/conflict-text';
import type { FileLoader, FileVersions } from '../../sync/load-file';
import type { PlanEntry } from '../../sync/types';
import { nameParts, renamedPath } from '../../sync/relocation';
import { mergedText } from '../../sync/text-merge';
import { renderFileReview, type FileReviewActions, type FileDraft } from './render';

export interface FileReviewOptions {
  singleFile?: boolean;
  embedded?: boolean;
  validateRename?(targetPath: string): void;
}

export class FileReviewEditor {
  private index = 0;
  private versions?: FileVersions;
  private localPreview?: AttachmentPreview;
  private remotePreview?: AttachmentPreview;
  private localText?: string;
  private remoteText?: string;
  private readonly drafts = new Map<string, FileDraft>();
  private pending?: FileDraft;
  private draftChanged = false;
  private readonly choices = new Map<string, Map<number, 'local' | 'remote'>>();
  private renameDraft?: { name: string; target?: string; error?: string };
  private tab: 'local' | 'remote' | 'result' = 'result';
  private loading = false;
  private error?: string;
  private request = 0;
  private disposed = false;
  private container?: HTMLElement;
  private readonly entries: PlanEntry[];

  constructor(
    entries: PlanEntry[],
    private readonly load: FileLoader,
    private readonly done: () => void,
    private readonly cancel: () => void,
    private readonly options: FileReviewOptions = {},
  ) {
    this.entries = options.singleFile
      ? entries
      : entries.filter((entry) => entry.action === 'conflict');
  }

  show(container: HTMLElement): void {
    this.container = container;
    if (!this.current().move && !this.versions && !this.loading && !this.error)
      void this.loadCurrent();
    else this.render();
  }

  hasUnsavedChanges(): boolean {
    return (
      this.draftChanged ||
      (!!this.renameDraft &&
        (!!this.renameDraft.error || this.renameDraft.target !== this.current().renameTo))
    );
  }

  private saveAndReturn(): void {
    this.draftChanged = false;
    this.renameDraft = undefined;
    this.done();
  }

  dispose(): void {
    this.disposed = true;
    this.clearAttachments();
    this.request++;
    this.container = undefined;
  }

  private current(): PlanEntry {
    const entry = this.entries[this.index];
    if (!entry) throw new Error(t('No file is selected.'));
    return entry;
  }

  private allResolved(): boolean {
    return this.entries.every((entry) => entry.resolution !== undefined);
  }

  private async loadCurrent(): Promise<void> {
    const request = ++this.request;
    const entry = this.current();
    this.clearAttachments();
    this.versions = undefined;
    this.localText = undefined;
    this.remoteText = undefined;
    this.error = undefined;
    this.loading = true;
    this.pending = undefined;
    this.render();
    try {
      const versions = await this.load(entry);
      if (this.disposed || request !== this.request) return;
      this.versions = versions;
      if (versions.local) this.localPreview = attachmentPreview(entry.path, versions.local.data);
      if (versions.remote) this.remotePreview = attachmentPreview(entry.path, versions.remote.data);
      const localText = versions.local ? editableText(entry.path, versions.local.data) : undefined;
      const remoteText = versions.remote
        ? editableText(entry.path, versions.remote.data)
        : undefined;
      const canEdit =
        (!versions.local || localText !== undefined) &&
        (!versions.remote || remoteText !== undefined);
      if (canEdit) {
        this.localText = localText;
        this.remoteText = remoteText;
      }
      if (!this.drafts.has(entry.path)) {
        const resolution = entry.resolution;
        const incoming = this.options.singleFile && entry.action === 'download';
        let kind: FileDraft['kind'] =
          incoming && versions.remote ? 'remote' : versions.local ? 'local' : 'remote';
        let text = incoming ? (remoteText ?? localText ?? '') : (localText ?? remoteText ?? '');
        if (canEdit) kind = 'text';
        if (entry.action === 'merge') text = mergedText(entry.merge) ?? text;
        if (resolution?.kind === 'text') text = resolution.text;
        else if (resolution?.kind === 'remote') {
          kind = canEdit ? 'text' : 'remote';
          text = remoteText ?? '';
        } else if (resolution?.kind === 'local') {
          kind = canEdit ? 'text' : 'local';
          text = localText ?? '';
        }
        const source =
          resolution?.kind === 'local' || resolution?.kind === 'remote'
            ? resolution.kind
            : !resolution && entry.action !== 'merge' && entry.action !== 'conflict'
              ? incoming || !versions.local
                ? 'remote'
                : 'local'
              : undefined;
        this.drafts.set(entry.path, { kind, text, edited: resolution?.kind === 'text', source });
      }
    } catch (error) {
      if (this.disposed || request !== this.request) return;
      this.error = error instanceof Error ? error.message : t('Could not read file versions.');
    } finally {
      if (!this.disposed && request === this.request) {
        this.loading = false;
        this.render();
      }
    }
  }

  private clearAttachments(): void {
    if (this.localPreview) URL.revokeObjectURL(this.localPreview.url);
    if (this.remotePreview) URL.revokeObjectURL(this.remotePreview.url);
    this.localPreview = undefined;
    this.remotePreview = undefined;
  }

  private setDraft(draft: FileDraft): void {
    this.draftChanged = true;
    this.drafts.set(this.current().path, draft);
    if (!this.options.singleFile) delete this.current().resolution;
    this.pending = undefined;
    this.tab = 'result';
    this.render();
  }

  private select(kind: 'local' | 'remote' | 'both'): void {
    if (!this.versions) return;
    if (kind === 'local' && !this.versions.local) return;
    if (kind === 'remote' && !this.versions.remote) return;
    const localText = this.localText;
    const remoteText = this.remoteText;
    const editable = localText !== undefined || remoteText !== undefined;
    let text = '';
    if (kind === 'both') {
      if (localText === undefined || remoteText === undefined) return;
      text = useBothVersions(localText, remoteText);
    } else text = (kind === 'local' ? localText : remoteText) ?? '';
    const draft: FileDraft = {
      kind: editable ? 'text' : kind === 'remote' ? 'remote' : 'local',
      text,
      edited: false,
      source: kind === 'both' ? undefined : kind,
    };
    const current = this.drafts.get(this.current().path);
    if (current?.edited && (current.text !== draft.text || current.kind !== draft.kind)) {
      this.pending = draft;
      this.render();
    } else this.setDraft(draft);
  }

  private mergeConflicts() {
    const entry = this.current();
    if (entry.action !== 'conflict' || this.drafts.get(entry.path)?.edited) return [];
    return (entry.merge ?? []).flatMap((chunk, index) =>
      'text' in chunk
        ? []
        : [{ ...chunk, index, selected: this.choices.get(entry.path)?.get(index) }],
    );
  }

  private chooseChunk(index: number, side: 'local' | 'remote'): void {
    const entry = this.current();
    const chunks = entry.merge;
    if (!chunks || !this.mergeConflicts().some((conflict) => conflict.index === index)) return;
    const choices = this.choices.get(entry.path) ?? new Map<number, 'local' | 'remote'>();
    choices.set(index, side);
    this.draftChanged = true;
    this.choices.set(entry.path, choices);
    if (!this.options.singleFile) delete entry.resolution;
    if (this.mergeConflicts().some((conflict) => !conflict.selected)) this.render();
    else {
      const text = chunks
        .map((chunk, position) => {
          if ('text' in chunk) return chunk.text;
          return choices.get(position) === 'remote' ? chunk.remote : chunk.local;
        })
        .join('');
      this.setDraft({ kind: 'text', text, edited: false });
    }
    this.container
      ?.querySelector<HTMLButtonElement>(`[data-merge-choice="${index}-${side}"]`)
      ?.focus({ preventScroll: true });
  }

  private changeName(name: string): string | undefined {
    const { path } = this.current();
    try {
      const target = renamedPath(path, name);
      if (target !== path) this.options.validateRename?.(target);
      this.renameDraft = { name, target: target === path ? undefined : target };
    } catch (error) {
      this.renameDraft = {
        name,
        error: error instanceof Error ? error.message : t('Enter a valid file name.'),
      };
    }
    return this.renameDraft.error;
  }

  private advance(): void {
    const next = this.entries.findIndex((entry) => entry.resolution === undefined);
    if (next >= 0 && next !== this.index) {
      this.index = next;
      this.tab = 'result';
      void this.loadCurrent();
    } else this.render();
  }

  private readonly actions: FileReviewActions = {
    move: (direction) => {
      this.index = (this.index + direction + this.entries.length) % this.entries.length;
      this.tab = 'result';
      void this.loadCurrent();
    },
    tab: (kind) => {
      this.tab = kind;
      this.render();
    },
    select: (kind) => this.select(kind),
    chooseChunk: (index, side) => this.chooseChunk(index, side),
    rename: (name) => this.changeName(name),
    edit: (text) => {
      this.draftChanged = true;
      this.drafts.set(this.current().path, { kind: 'text', text, edited: true });
      if (!this.options.singleFile) delete this.current().resolution;
      this.pending = undefined;
      const button = this.container?.querySelector<HTMLButtonElement>('[data-role="resolve"]');
      if (button) {
        button.textContent = this.options.singleFile ? t('Apply to preview') : t('Mark resolved');
        button.disabled = !!this.renameDraft?.error;
      }
      this.container?.querySelector('.yds-conflict-replacement')?.remove();
      this.container?.querySelector('.yds-merge-choices')?.remove();
      const status = this.container?.querySelector('[data-role=conflict-status]');
      if (status)
        status.textContent =
          this.entries.filter((entry) => entry.resolution).length +
          ' / ' +
          this.entries.length +
          t(' resolved · no files saved yet');
    },
    replace: () => {
      if (this.pending) this.setDraft(this.pending);
    },
    keepEditing: () => {
      this.pending = undefined;
      this.tab = 'result';
      this.render();
    },
    skip: () => {
      this.current().resolution = { kind: 'skip' };
      delete this.current().renameTo;
      if (this.options.singleFile) this.saveAndReturn();
      else this.advance();
    },
    remove: () => {
      if (this.loading || this.error || !this.versions) return;
      this.current().resolution = { kind: 'delete' };
      delete this.current().renameTo;
      if (this.options.singleFile) this.saveAndReturn();
      else this.advance();
    },
    resolve: () => {
      if (this.pending || this.loading || this.renameDraft?.error) return;
      if (!this.options.singleFile && this.allResolved()) {
        this.done();
        return;
      }
      if (this.mergeConflicts().some((conflict) => !conflict.selected)) return;
      const draft = this.drafts.get(this.current().path);
      if (!draft || this.error) return;
      const entry = this.current();
      if (this.renameDraft) entry.renameTo = this.renameDraft.target;
      const source = draft.edited ? undefined : draft.source;
      if (source && entry.action === 'unchanged' && !entry.renameTo) delete entry.resolution;
      else if (source) entry.resolution = { kind: source };
      else
        entry.resolution =
          draft.kind === 'text' ? { kind: 'text', text: draft.text } : { kind: draft.kind };
      if (this.options.singleFile) this.saveAndReturn();
      else this.advance();
    },
    cancel: () => this.cancel(),
  };

  private render(): void {
    if (!this.container || this.disposed) return;
    const entry = this.current();
    const name = nameParts(entry.renameTo ?? entry.path);
    renderFileReview(
      this.container,
      {
        singleFile: this.options.singleFile,
        embedded: this.options.embedded,
        localPreview: this.localPreview,
        remotePreview: this.remotePreview,
        markedForDeletion: this.current().resolution?.kind === 'delete',
        hasLocal: !!this.versions?.local,
        hasRemote: !!this.versions?.remote,
        path: entry.path,
        movingTo: entry.move?.targetPath,
        mergeConflicts: this.mergeConflicts(),
        rename:
          this.options.validateRename &&
          !this.loading &&
          !this.error &&
          !entry.move &&
          !['skip', 'missing', 'error'].includes(entry.action)
            ? { ...name, stem: this.renameDraft?.name ?? name.stem, error: this.renameDraft?.error }
            : undefined,
        index: this.index,
        total: this.entries.length,
        resolved: this.entries.filter((entry) => entry.resolution).length,
        loading: this.loading,
        error: this.error,
        localText: this.localText,
        remoteText: this.remoteText,
        localSize: this.versions?.local?.data.byteLength,
        remoteSize: this.versions?.remote?.data.byteLength,
        draft: this.drafts.get(this.current().path),
        pending: this.pending,
        tab: this.tab,
        allResolved: this.allResolved(),
      },
      this.actions,
    );
  }
}
