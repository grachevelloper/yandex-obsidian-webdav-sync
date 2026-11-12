import { t } from '../i18n';

import type { PlanEntry, SyncPlan } from '../sync/types';
import { relocationTarget } from '../sync/relocation';
import { fileTree, type FileFolder } from './file-tree';

export interface PreviewListState {
  collapsed: Set<string>;
  showUnchanged: boolean;
}

export function renderPreview(
  container: HTMLElement,
  plan: SyncPlan,
  openFile?: (entry: PlanEntry) => void,
  {
    split = false,
    listState = { collapsed: new Set(), showUnchanged: false },
  }: {
    split?: boolean;
    listState?: PreviewListState;
  } = {},
) {
  const fragment = container.ownerDocument.adoptNode(createFragment());
  const create = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    value?: string,
  ) => {
    return fragment.createEl(tag, { cls: className, text: value });
  };

  container.replaceChildren();
  container.classList.add('yds-preview');
  const errors = plan.entries.filter(
    ({ action, resolution }) => action === 'error' && resolution?.kind !== 'skip',
  ).length;
  const changes = plan.entries
    .filter((entry) => entry.resolution?.kind !== 'skip')
    .filter(
      ({ action, resolution, renameTo }) =>
        !!renameTo ||
        action === 'move' ||
        action === 'merge' ||
        action === 'upload' ||
        action === 'download' ||
        action === 'conflict' ||
        action === 'delete-local' ||
        action === 'delete-remote' ||
        !!resolution,
    ).length;
  const unresolved = plan.entries.filter(
    (entry) => entry.action === 'conflict' && !entry.resolution,
  ).length;
  const deletions = plan.entries.filter(
    (entry) =>
      !entry.resolution && (entry.action === 'delete-local' || entry.action === 'delete-remote'),
  ).length;
  const reviewedDeletions = plan.entries.filter(
    (entry) => entry.resolution?.kind === 'delete',
  ).length;
  const inactive = plan.entries.filter(
    (entry) =>
      !entry.resolution &&
      !entry.renameTo &&
      (entry.action === 'unchanged' || entry.action === 'missing'),
  ).length;
  const toolbar = create('div', 'yds-preview-toolbar');
  toolbar.append(
    create(
      'span',
      '',
      t('{0} files total · {1} changes{2}', {
        '0': plan.entries.length,
        '1': changes,
        '2': errors ? t(' · {0} errors', { '0': errors }) : '',
      }),
    ),
  );
  const showUnchanged = create('input', '');
  showUnchanged.type = 'checkbox';
  showUnchanged.checked = listState.showUnchanged;
  if (inactive) {
    const label = create('label', 'yds-preview-filter');
    label.append(showUnchanged, create('span', '', t('Show unchanged ({0})', { '0': inactive })));
    toolbar.append(label);
  }
  container.append(toolbar);

  const list = create('div', 'yds-preview-list');
  const table = create('table', 'yds-preview-table');
  const header = create('thead', '');
  const columns = create('tr', '');
  for (const title of [t('File'), t('Action')]) {
    const cell = create('th', '', title);
    cell.scope = 'col';
    columns.append(cell);
  }
  header.append(columns);
  const body = create('tbody', '');
  table.append(header, body);
  list.append(table);
  const detail = split ? create('div', 'yds-preview-detail') : undefined;
  if (detail) {
    detail.tabIndex = -1;
    const workspace = create('div', 'yds-preview-workspace');
    workspace.append(list, detail);
    container.append(workspace);
  } else container.append(list);

  const { collapsed } = listState;
  const fileButtons = new Map<PlanEntry, HTMLElement>();
  let selected: PlanEntry | undefined;

  function selectFile(entry?: PlanEntry): void {
    if (selected) fileButtons.get(selected)?.removeAttribute('aria-current');
    selected = entry;
    if (entry) fileButtons.get(entry)?.setAttribute('aria-current', 'true');
  }

  function renderFiles(): void {
    body.replaceChildren();
    fileButtons.clear();
    const entries = plan.entries.filter(
      (entry) =>
        showUnchanged.checked ||
        !!entry.renameTo ||
        !!entry.resolution ||
        (entry.action !== 'unchanged' && entry.action !== 'missing'),
    );
    const rows: { element: HTMLTableRowElement; parents: string[] }[] = [];
    const updateVisibility = () => {
      for (const row of rows) row.element.hidden = row.parents.some((path) => collapsed.has(path));
    };

    function appendFolder(parent: FileFolder, parents: string[], depth: number): void {
      for (const folder of [...parent.folders.values()].sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        const row = create('tr', 'yds-preview-folder');
        row.style.setProperty('--yds-depth', String(Math.min(depth, 6)));
        const cell = create('td', 'yds-preview-file-cell');
        cell.colSpan = 2;
        const button = create('button', 'yds-folder-toggle');
        button.type = 'button';
        const chevron = create('span', 'yds-tree-chevron');
        chevron.setAttribute('aria-hidden', 'true');
        const updateButton = () => {
          const open = !collapsed.has(folder.path);
          chevron.textContent = open ? '▾' : '▸';
          button.setAttribute('aria-expanded', String(open));
        };
        updateButton();
        button.append(
          chevron,
          create('span', 'yds-preview-name', folder.name),
          create('span', 'yds-folder-count', String(folder.count)),
        );
        button.addEventListener('click', () => {
          if (collapsed.has(folder.path)) collapsed.delete(folder.path);
          else collapsed.add(folder.path);
          updateButton();
          updateVisibility();
        });
        cell.append(button);
        row.append(cell);
        body.append(row);
        rows.push({ element: row, parents });
        appendFolder(folder, [...parents, folder.path], depth + 1);
      }

      for (const entry of [...parent.files].sort((a, b) => a.path.localeCompare(b.path))) {
        const actionStyle = entry.resolution?.kind ?? (entry.renameTo ? 'rename' : entry.action);
        const row = create('tr', `yds-preview-file yds-action-${actionStyle}`);
        row.style.setProperty('--yds-depth', String(Math.min(depth, 6)));
        const name = create('td', 'yds-preview-file-cell');
        const filename = create(
          openFile ? 'button' : 'span',
          'yds-preview-name',
          entry.path.split('/').at(-1),
        );
        if (openFile) {
          filename.classList.add('yds-preview-open');
          filename.setAttribute('type', 'button');
          row.addEventListener('click', () => openFile(entry));
          fileButtons.set(entry, filename);
        }
        name.append(filename);
        if (entry.copyPath && !entry.resolution && !plan.mode) {
          const copy = create('details', 'yds-preview-copy');
          copy.addEventListener('click', (event) => event.stopPropagation());
          copy.append(
            create('summary', '', t('Conflict copy')),
            create('code', '', entry.copyPath),
          );
          name.append(copy);
        }
        if (entry.message) name.append(create('span', 'yds-preview-message', entry.message));
        const label = actionLabel(entry);
        const target =
          entry.resolution?.kind === 'skip' || entry.resolution?.kind === 'delete'
            ? undefined
            : relocationTarget(entry);
        if (target)
          name.append(create('span', 'yds-preview-target', t('New path: {0}', { '0': target })));
        const inline = create('span', 'yds-preview-action yds-preview-action-inline', label);
        const action = create('td', 'yds-preview-action', label);
        name.append(inline);
        row.append(name, action);
        body.append(row);
        rows.push({ element: row, parents });
      }
    }

    appendFolder(fileTree(entries), [], 0);
    if (!entries.length) {
      const row = create('tr', '');
      const cell = create('td', 'yds-preview-empty', t('No file changes'));
      cell.colSpan = 2;
      row.append(cell);
      body.append(row);
    }
    updateVisibility();
    selectFile(selected);
  }

  showUnchanged.addEventListener('change', () => {
    listState.showUnchanged = showUnchanged.checked;
    renderFiles();
  });
  renderFiles();
  if (errors)
    container.append(
      create(
        'p',
        'yds-preview-warning',
        t('Confirmation is disabled. Resolve the errors and prepare a new preview.'),
      ),
    );
  const mirror = plan.mode === 'device-wins' || plan.mode === 'cloud-wins';
  const reviewed = plan.entries.some(
    (entry) => !!entry.renameTo || (entry.resolution && entry.resolution.kind !== 'skip'),
  );
  const direction =
    plan.mode === 'device-wins'
      ? t('Device → Disk · ') + deletions + t(' cloud files will be deleted.')
      : t('Disk → device · ') + deletions + t(' local files will be deleted.');
  container.append(
    create(
      'p',
      'yds-preview-hint',
      mirror
        ? direction +
            ' ' +
            (reviewed
              ? t('Reviewed files are saved on both sides; the source may change.')
              : t('The source stays unchanged.'))
        : reviewedDeletions || plan.entries.some((entry) => relocationTarget(entry))
          ? t('Files will change after you confirm.')
          : t('No files will be deleted.'),
    ),
  );
  if (reviewedDeletions)
    container.append(
      create(
        'p',
        'yds-preview-warning',
        t('Files marked for deletion from both sides: {0}', { '0': reviewedDeletions }),
      ),
    );
  if (
    plan.mode &&
    plan.mode !== 'two-way' &&
    plan.entries.some((entry) => entry.resolution?.kind === 'skip')
  )
    container.append(
      create(
        'p',
        'yds-preview-warning',
        t('Skipped files are excluded. The destination will not be an exact copy.'),
      ),
    );
  const actions = create('div', 'yds-preview-actions');
  container.append(actions);

  return {
    actions,
    list,
    detail,
    selectFile,
    canConfirm: errors === 0 && unresolved === 0,
    changes,
    unresolved,
  };
}

function actionLabel(entry: PlanEntry): string {
  if (entry.resolution?.kind === 'delete') return t('Delete from both sides');
  if (entry.resolution?.kind === 'skip') return t('Skipped');
  if (entry.renameTo) return t('Save with new name');
  if (entry.resolution?.kind === 'text') return t('Save result on Disk and device');
  if (entry.resolution?.kind === 'local') return transferLabel('upload', entry);
  if (entry.resolution?.kind === 'remote') return transferLabel('download', entry);
  switch (entry.action) {
    case 'upload':
    case 'download':
      return transferLabel(entry.action, entry);
    case 'conflict':
      return t('Choose a result');
    case 'merge':
      return t('Merge edits');
    case 'move':
      return entry.localHash ? t('Move on device') : t('Move on Disk');
    case 'delete-local':
      return t('Delete local');
    case 'delete-remote':
      return t('Delete on Disk');
    case 'skip':
      return t('Skipped');
    case 'error':
      return t('Error');
    case 'unchanged':
      return t('Unchanged');
    case 'missing':
      return t('No action');
  }
}

function transferLabel(action: 'upload' | 'download', entry: PlanEntry): string {
  if (action === 'upload')
    return entry.remoteHash
      ? t('Update on Disk')
      : entry.baseline
        ? t('Restore on Disk')
        : t('Add to Disk');
  return entry.localHash
    ? t('Update on device')
    : entry.baseline
      ? t('Restore on device')
      : t('Add to device');
}
