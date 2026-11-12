import { t } from '../../i18n';
import type { AttachmentPreview } from './attachment';

export interface FileDraft {
  kind: 'text' | 'local' | 'remote';
  text: string;
  edited: boolean;
  source?: 'local' | 'remote';
}

export interface FileReviewView {
  localPreview?: AttachmentPreview;
  remotePreview?: AttachmentPreview;
  singleFile?: boolean;
  embedded?: boolean;
  markedForDeletion: boolean;
  hasLocal: boolean;
  hasRemote: boolean;
  path: string;
  movingTo?: string;
  mergeConflicts: {
    index: number;
    local: string;
    remote: string;
    base: string;
    selected?: 'local' | 'remote';
  }[];
  rename?: { stem: string; extension: string; error?: string };
  index: number;
  total: number;
  resolved: number;
  loading: boolean;
  error?: string;
  localText?: string;
  remoteText?: string;
  localSize?: number;
  remoteSize?: number;
  draft?: FileDraft;
  pending?: FileDraft;
  tab: 'local' | 'remote' | 'result';
  allResolved: boolean;
}

export interface FileReviewActions {
  move(this: void, direction: number): void;
  select(this: void, kind: 'local' | 'remote' | 'both'): void;
  tab(this: void, kind: 'local' | 'remote' | 'result'): void;
  edit(this: void, text: string): void;
  chooseChunk(this: void, index: number, side: 'local' | 'remote'): void;
  rename(this: void, name: string): string | undefined;
  replace(this: void): void;
  keepEditing(this: void): void;
  skip(this: void): void;
  remove(this: void): void;
  resolve(this: void): void;
  cancel(this: void): void;
}

export function renderFileReview(
  container: HTMLElement,
  view: FileReviewView,
  actions: FileReviewActions,
): void {
  const fragment = container.ownerDocument.adoptNode(createFragment());
  const create = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    text?: string,
  ) => {
    return fragment.createEl(tag, { cls: className, text });
  };
  const button = (label: string, callback: () => void) => {
    const node = create('button', '', label);
    node.type = 'button';
    node.addEventListener('click', callback);
    return node;
  };

  container.replaceChildren();
  container.classList.add('yds-conflict-editor');
  container.dataset.tab = view.tab;
  const header = create('div', 'yds-conflict-header');
  const rename = view.rename;
  if (rename) {
    const title = create('div', 'yds-review-filename');
    const name = button(rename.stem + rename.extension, () => {
      const initial = rename.stem;
      const input = create('input', '');
      input.type = 'text';
      input.value = initial;
      input.setAttribute('aria-label', t('File name without extension'));
      const extension = create('span', '', rename.extension);
      const field = create('div', 'yds-filename-field');
      field.append(input, extension);
      name.replaceWith(field);
      input.focus();
      input.select();

      const checkName = () => {
        rename.error = actions.rename(input.value);
        warning.textContent = rename.error ?? '';
        input.setAttribute('aria-invalid', String(!!rename.error));
        const save = container.querySelector<HTMLButtonElement>('[data-role="resolve"]');
        if (save) save.disabled = !!rename.error || unresolved || !!view.pending;
      };
      input.addEventListener('input', checkName);
      input.addEventListener('blur', () => {
        checkName();
        if (rename.error) return;
        rename.stem = input.value.trim();
        name.textContent = rename.stem + rename.extension;
        field.replaceWith(name);
      });
      input.addEventListener('keydown', (event) => {
        if (event.isComposing || (event.key !== 'Enter' && event.key !== 'Escape')) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === 'Escape') input.value = initial;
        input.blur();
        if (name.isConnected) name.focus();
      });
    });
    name.classList.add('yds-rename-file');
    name.setAttribute('aria-description', t('Edit file name'));
    const warning = create('span', 'yds-filename-warning', rename.error);
    warning.setAttribute('role', 'alert');
    title.append(name, warning);
    header.append(title);
  } else header.append(create('code', 'yds-path', view.path));
  if (!view.singleFile)
    header.append(create('span', '', String(view.index + 1) + ' / ' + view.total));
  const previous = button('‹', () => actions.move(-1));
  const next = button('›', () => actions.move(1));
  previous.setAttribute('aria-label', t('Previous conflict'));
  next.setAttribute('aria-label', t('Next conflict'));
  if (!view.singleFile) header.append(previous, next);
  container.append(header);
  const backLabel = view.embedded
    ? t('Close file')
    : view.singleFile
      ? t('Back to preview')
      : t('Cancel run');
  const unresolved =
    (view.singleFile || !view.allResolved) &&
    view.mergeConflicts.some((conflict) => !conflict.selected);

  if (view.movingTo) {
    const path = create('p', 'yds-preview-target', t('New path: {0}', { '0': view.movingTo }));
    const footer = create('div', 'yds-preview-actions');
    footer.append(button(backLabel, actions.cancel), button(t('Skip file'), actions.skip));
    container.append(path, footer);
    return;
  }

  const tabs = create('div', 'yds-conflict-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', t('Conflict versions'));
  for (const [kind, label] of [
    ['local', t('Local')],
    ['remote', t('Yandex Disk')],
    ['result', t('Result')],
  ] as const) {
    const tab = button(label, () => actions.tab(kind));
    tab.id = 'yds-conflict-tab-' + kind;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', 'yds-conflict-panel-' + kind);
    tab.setAttribute('aria-selected', String(view.tab === kind));
    tabs.append(tab);
  }
  container.append(tabs);
  const body = create('div', 'yds-file-review-body');
  container.append(body);

  if (view.loading) body.append(create('p', 'yds-conflict-status', t('Reading current versions…')));
  if (view.error) {
    const error = create('p', 'yds-preview-warning', view.error);
    error.setAttribute('role', 'alert');
    body.append(error);
  }
  if (!view.loading && !view.error && view.draft) {
    const versions = create('div', 'yds-conflict-sources');
    for (const kind of ['local', 'remote'] as const) {
      const source = create('section', 'yds-conflict-version');
      source.dataset.side = kind;
      source.id = 'yds-conflict-panel-' + kind;
      source.setAttribute('aria-labelledby', 'yds-conflict-tab-' + kind);
      const heading = create('div', 'yds-conflict-source-header');
      heading.append(
        create(
          'strong',
          '',
          kind === 'local' ? t('Local · this device') : t('Incoming · Yandex Disk'),
        ),
      );
      const exists = kind === 'local' ? view.hasLocal : view.hasRemote;
      if (exists && view.mergeConflicts.length === 0)
        heading.append(
          button(kind === 'local' ? t('Use local') : t('Use Disk'), () => actions.select(kind)),
        );
      const text = kind === 'local' ? view.localText : view.remoteText;
      const size = kind === 'local' ? view.localSize : view.remoteSize;
      source.append(
        heading,
        create(
          'pre',
          '',
          text ??
            (size === undefined
              ? t('Not present on this side')
              : t('Attachment · ') + size + t(' bytes')),
        ),
      );
      const preview = kind === 'local' ? view.localPreview : view.remotePreview;
      if (preview) {
        if (preview.kind === 'image') {
          const image = create('img', 'yds-attachment-image');
          image.src = preview.url;
          image.alt = view.path + (kind === 'local' ? t(' · local') : t(' · Yandex Disk'));
          source.append(image);
        } else {
          const frame = create('iframe', 'yds-attachment-pdf');
          frame.src = preview.url;
          frame.title = view.path + t(' · PDF preview');
          source.append(frame);
        }
        const open = create('a', 'yds-attachment-link', t('Open attachment'));
        open.href = preview.url;
        open.target = '_blank';
        open.rel = 'noopener';
        source.append(open);
      }
      versions.append(source);
    }
    const result = create('section', 'yds-conflict-result');
    result.dataset.side = 'result';
    result.id = 'yds-conflict-panel-result';
    result.setAttribute('aria-labelledby', 'yds-conflict-tab-result');
    result.append(
      create(
        'strong',
        '',
        t('Result · ') + (view.draft.kind === 'text' ? t('editable') : t('selected version')),
      ),
    );
    if (view.mergeConflicts.length) {
      const choices = create('div', 'yds-merge-choices');
      choices.append(
        create(
          'p',
          'yds-conflict-status',
          t('Choose each conflicting section. Other edits are already combined.'),
        ),
      );
      for (const [position, conflict] of view.mergeConflicts.entries()) {
        const section = create('section', 'yds-merge-chunk');
        section.append(create('strong', '', t('Section {0}', { '0': position + 1 })));
        const options = create('div', 'yds-merge-options');
        for (const side of ['local', 'remote'] as const) {
          const option = create('div', '');
          const choose = button(side === 'local' ? t('Use local') : t('Use Disk'), () =>
            actions.chooseChunk(conflict.index, side),
          );
          choose.dataset.mergeChoice = `${conflict.index}-${side}`;
          choose.setAttribute('aria-pressed', String(conflict.selected === side));
          if (conflict.selected === side) choose.classList.add('mod-cta');
          option.append(
            create('pre', '', conflict[side] || t('This version removed these lines.')),
            choose,
          );
          options.append(option);
        }
        const base = create('details', '');
        base.append(
          create('summary', '', t('Last common text')),
          create('pre', '', conflict.base || t('No text at this position.')),
        );
        section.append(options, base);
        choices.append(section);
      }
      result.append(choices);
    }
    if (view.draft.kind === 'text' && !unresolved) {
      const editor = create('textarea', 'yds-conflict-input');
      editor.setAttribute('aria-label', t('Merged result for ') + view.path);
      editor.spellcheck = false;
      editor.value = view.draft.text;
      editor.addEventListener('input', () => actions.edit(editor.value));
      result.append(editor);
    } else if (view.draft.kind !== 'text') {
      result.append(
        create(
          'p',
          '',
          view.draft.kind === 'local'
            ? t('Keep this device’s file on both sides.')
            : t('Keep the Yandex Disk file on both sides.'),
        ),
      );
    }
    body.append(versions, result);
  }

  if (view.pending) {
    const replacement = create('div', 'yds-conflict-replacement');
    replacement.setAttribute('role', 'alert');
    replacement.append(
      create('span', '', t('Replace your edited result?')),
      button(t('Keep editing'), actions.keepEditing),
      button(t('Replace result'), actions.replace),
    );
    body.append(replacement);
  }

  const footer = create('div', 'yds-preview-actions');
  footer.append(button(backLabel, actions.cancel), button(t('Skip file'), actions.skip));
  if (
    view.localText !== undefined &&
    view.remoteText !== undefined &&
    view.mergeConflicts.length === 0
  )
    footer.append(button(t('Use both'), () => actions.select('both')));
  if (view.markedForDeletion) {
    container.append(
      create(
        'p',
        'yds-preview-warning',
        t('Deletion staged. Apply a version or skip the file to cancel it.'),
      ),
    );
  } else if (!view.loading && !view.error && (view.hasLocal || view.hasRemote)) {
    const remove = button(t('Stage deletion from both sides'), actions.remove);
    remove.classList.add('mod-warning');
    footer.append(remove);
  }

  const resolve = button(
    view.singleFile
      ? t('Apply to preview')
      : view.allResolved
        ? t('Review & save…')
        : t('Mark resolved'),
    actions.resolve,
  );
  resolve.classList.add('mod-cta');
  resolve.dataset.role = 'resolve';
  resolve.disabled =
    !!view.pending ||
    view.loading ||
    unresolved ||
    !!view.rename?.error ||
    (!!view.error && !view.allResolved);
  footer.append(resolve);
  const status = create(
    'p',
    'yds-conflict-status',
    String(view.resolved) + ' / ' + view.total + t(' resolved · no files saved yet'),
  );
  status.dataset.role = 'conflict-status';
  if (view.singleFile)
    status.textContent = t(
      'Apply to preview stages your choice. Files change only after final confirmation.',
    );
  status.setAttribute('aria-live', 'polite');
  container.append(footer);
  if (!view.embedded) container.append(status);
}
