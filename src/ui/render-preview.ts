import type { PlanEntry, SyncPlan } from '../sync/types';
import { fileTree, type FileFolder } from './file-tree';

export function renderPreview(container: HTMLElement, plan: SyncPlan) {
  const document = container.ownerDocument;
  const create = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    value?: string,
  ) => {
    const element = document.createElement(tag);
    element.className = className;
    if (value !== undefined) element.textContent = value;
    return element;
  };

  container.replaceChildren();
  container.classList.add('yds-preview');
  const errors = plan.entries.filter(({ action }) => action === 'error').length;
  const changes = plan.entries.filter(
    ({ action }) => action === 'upload' || action === 'download' || action === 'conflict',
  ).length;
  const inactive = plan.entries.filter(
    ({ action }) => action === 'unchanged' || action === 'missing',
  ).length;
  const toolbar = create('div', 'yds-preview-toolbar');
  toolbar.append(
    create(
      'span',
      '',
      `${plan.entries.length} files total · ${changes} changes${errors ? ` · ${errors} errors` : ''}`,
    ),
  );
  const showUnchanged = create('input', '');
  showUnchanged.type = 'checkbox';
  if (inactive) {
    const label = create('label', 'yds-preview-filter');
    label.append(showUnchanged, create('span', '', `Show unchanged (${inactive})`));
    toolbar.append(label);
  }
  container.append(toolbar);

  const list = create('div', 'yds-preview-list');
  const table = create('table', 'yds-preview-table');
  table.setAttribute('aria-label', 'Files in the sync preview');
  const header = create('thead', '');
  const columns = create('tr', '');
  for (const title of ['File', 'Action']) {
    const cell = create('th', '', title);
    cell.scope = 'col';
    columns.append(cell);
  }
  header.append(columns);
  const body = create('tbody', '');
  table.append(header, body);
  list.append(table);
  container.append(list);
  const collapsed = new Set<string>();

  function renderFiles(): void {
    body.replaceChildren();
    const entries = plan.entries.filter(
      ({ action }) => showUnchanged.checked || (action !== 'unchanged' && action !== 'missing'),
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
        button.title = folder.path;
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
        const row = create('tr', `yds-preview-file yds-action-${entry.action}`);
        row.style.setProperty('--yds-depth', String(Math.min(depth, 6)));
        const name = create('td', 'yds-preview-file-cell');
        const filename = create('span', 'yds-preview-name', entry.path.split('/').at(-1));
        filename.title = entry.path;
        name.append(filename);
        if (entry.copyPath) {
          const copy = create('details', 'yds-preview-copy');
          copy.append(create('summary', '', 'Conflict copy'), create('code', '', entry.copyPath));
          name.append(copy);
        }
        if (entry.message) name.append(create('span', 'yds-preview-message', entry.message));
        const action = create('td', 'yds-preview-action', actionLabel(entry));
        action.title = describeEntry(entry);
        row.append(name, action);
        body.append(row);
        rows.push({ element: row, parents });
      }
    }

    appendFolder(fileTree(entries), [], 0);
    if (!entries.length) {
      const row = create('tr', '');
      const cell = create('td', 'yds-preview-empty', 'No file changes');
      cell.colSpan = 2;
      row.append(cell);
      body.append(row);
    }
    updateVisibility();
  }

  showUnchanged.addEventListener('change', renderFiles);
  renderFiles();
  if (errors)
    container.append(
      create(
        'p',
        'yds-preview-warning',
        'Confirmation is disabled. Resolve the errors and prepare a new preview.',
      ),
    );
  container.append(
    create('p', 'yds-preview-hint', '↑ Yandex Disk · ↓ This device · No files will be deleted.'),
  );
  const actions = create('div', 'yds-preview-actions');
  container.append(actions);

  return { actions, canConfirm: errors === 0, changes };
}

function actionLabel(entry: PlanEntry): string {
  switch (entry.action) {
    case 'upload':
      return entry.baseline && !entry.remoteHash ? '↑ Restore' : '↑ Upload';
    case 'download':
      return entry.baseline && !entry.localHash ? '↓ Restore' : '↓ Download';
    case 'conflict':
      return '⇄ Keep both';
    case 'skip':
      return 'Skipped';
    case 'error':
      return 'Error';
    case 'unchanged':
      return 'Unchanged';
    case 'missing':
      return 'No action';
  }
}

function describeEntry(entry: PlanEntry): string {
  if (entry.action === 'conflict')
    return 'Keep the cloud version under the original name and preserve the local version as a copy on both sides.';
  if (entry.action === 'upload')
    return entry.remoteHash
      ? 'Replace the cloud version with this device’s version.'
      : entry.baseline
        ? 'Restore the missing file on Yandex Disk.'
        : 'Create this file on Yandex Disk.';
  if (entry.action === 'download')
    return entry.localHash
      ? 'Replace this device’s version with the cloud version.'
      : entry.baseline
        ? 'Restore the missing file on this device.'
        : 'Create this file on this device.';
  return entry.message ?? '';
}
