import { t } from '../../i18n';
import type { AttachmentPreview } from './attachment';

export interface FileDraft {
  kind: 'text' | 'local' | 'remote';
  text: string;
  edited: boolean;
}

export interface FileReviewView {
  localPreview?: AttachmentPreview;
  remotePreview?: AttachmentPreview;
  singleFile?: boolean;
  markedForDeletion: boolean;
  hasLocal: boolean;
  hasRemote: boolean;
  path: string;
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
  move(direction: number): void;
  select(kind: 'local' | 'remote' | 'both'): void;
  tab(kind: 'local' | 'remote' | 'result'): void;
  edit(text: string): void;
  replace(): void;
  keepEditing(): void;
  skip(): void;
  remove(): void;
  resolve(): void;
  cancel(): void;
}

export function renderFileReview(
  container: HTMLElement,
  view: FileReviewView,
  actions: FileReviewActions,
): void {
  const document = container.ownerDocument;
  const create = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    text?: string,
  ) => {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
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
  header.append(
    create('code', 'yds-path', view.path),
    create('span', '', String(view.index + 1) + ' / ' + view.total),
  );
  const previous = button('‹', () => actions.move(-1));
  const next = button('›', () => actions.move(1));
  previous.setAttribute('aria-label', t('Previous conflict'));
  next.setAttribute('aria-label', t('Next conflict'));
  if (!view.singleFile) header.append(previous, next);
  container.append(header);

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

  if (view.loading)
    container.append(create('p', 'yds-conflict-status', t('Reading current versions…')));
  if (view.error) {
    const error = create('p', 'yds-preview-warning', view.error);
    error.setAttribute('role', 'alert');
    container.append(error);
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
      if (exists)
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
    if (view.draft.kind === 'text') {
      const editor = create('textarea', 'yds-conflict-input');
      editor.setAttribute('aria-label', t('Merged result for ') + view.path);
      editor.spellcheck = false;
      editor.value = view.draft.text;
      editor.addEventListener('input', () => actions.edit(editor.value));
      result.append(editor);
    } else {
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
    container.append(versions);
    container.append(result);
  }

  if (view.pending) {
    const replacement = create('div', 'yds-conflict-replacement');
    replacement.setAttribute('role', 'alert');
    replacement.append(
      create('span', '', t('Replace your edited result?')),
      button(t('Keep editing'), actions.keepEditing),
      button(t('Replace result'), actions.replace),
    );
    container.append(replacement);
  }

  const footer = create('div', 'yds-preview-actions');
  footer.append(
    button(view.singleFile ? t('Back to preview') : t('Cancel run'), actions.cancel),
    button(t('Skip file'), actions.skip),
  );
  if (view.localText !== undefined && view.remoteText !== undefined)
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
  resolve.disabled = !!view.pending || view.loading || (!!view.error && !view.allResolved);
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
  container.append(footer, status);
}
