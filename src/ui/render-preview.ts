import { t } from '../i18n';

import type { PlanEntry, SyncPlan } from '../sync/types';
import { fileTree, type FileFolder } from './file-tree';

export function renderPreview(
  container: HTMLElement,
  plan: SyncPlan,
  openFile?: (entry: PlanEntry) => void,
) {
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
  const errors = plan.entries.filter(
    ({ action, resolution }) => action === 'error' && resolution?.kind !== 'skip',
  ).length;
  const changes = plan.entries
    .filter((entry) => entry.resolution?.kind !== 'skip')
    .filter(
      ({ action, resolution }) =>
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
    ({ action, resolution }) => !resolution && (action === 'unchanged' || action === 'missing'),
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
  if (inactive) {
    const label = create('label', 'yds-preview-filter');
    label.append(showUnchanged, create('span', '', t('Show unchanged ({0})', { '0': inactive })));
    toolbar.append(label);
  }
  container.append(toolbar);

  const list = create('div', 'yds-preview-list');
  const table = create('table', 'yds-preview-table');
  table.setAttribute('aria-label', t('Files in the sync preview'));
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
        const row = create(
          'tr',
          `yds-preview-file yds-action-${entry.resolution?.kind === 'delete' ? 'delete-local' : entry.action}`,
        );
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
          filename.addEventListener('click', () => openFile(entry));
        }
        filename.title = entry.path;
        name.append(filename);
        if (entry.copyPath && !entry.resolution && !plan.mode) {
          const copy = create('details', 'yds-preview-copy');
          copy.append(
            create('summary', '', t('Conflict copy')),
            create('code', '', entry.copyPath),
          );
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
      const cell = create('td', 'yds-preview-empty', t('No file changes'));
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
        t('Confirmation is disabled. Resolve the errors and prepare a new preview.'),
      ),
    );
  const mirror = plan.mode === 'device-wins' || plan.mode === 'cloud-wins';
  const reviewed = plan.entries.some(
    (entry) => entry.resolution && entry.resolution.kind !== 'skip',
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
        : reviewedDeletions
          ? t('↑ Yandex Disk · ↓ This device')
          : t('↑ Yandex Disk · ↓ This device · No files will be deleted.'),
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

  return { actions, canConfirm: errors === 0 && unresolved === 0, changes, unresolved };
}

function actionLabel(entry: PlanEntry): string {
  if (entry.resolution?.kind === 'delete') return t('Delete from both sides');
  if (entry.resolution?.kind === 'skip') return t('Skipped');
  if (entry.resolution && entry.action !== 'conflict') return t('⇄ Reviewed');
  switch (entry.action) {
    case 'upload':
      return entry.baseline && !entry.remoteHash ? t('↑ Restore') : t('↑ Upload');
    case 'download':
      return entry.baseline && !entry.localHash ? t('↓ Restore') : t('↓ Download');
    case 'conflict':
      return entry.resolution ? t('⇄ Resolved') : t('⇄ Resolve');
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

function describeEntry(entry: PlanEntry): string {
  if (entry.resolution?.kind === 'delete')
    return t('After confirmation, delete existing versions from the device and Yandex Disk.');
  if (entry.resolution?.kind === 'skip')
    return t('Skip this file for this run. Neither side is changed.');
  if (entry.resolution?.kind === 'text') return t('Save the edited result on both sides.');
  if (entry.resolution?.kind === 'local') return t('Keep this device’s version on both sides.');
  if (entry.resolution?.kind === 'remote') return t('Keep the Yandex Disk version on both sides.');
  if (entry.action === 'conflict')
    return entry.resolution
      ? t('Apply the approved result to both sides, or leave a skipped conflict unchanged.')
      : t('Compare both versions and choose or edit the result before confirming.');
  if (entry.action === 'delete-local')
    return t('Remove the device-only file after saving a local recovery copy.');
  if (entry.action === 'delete-remote')
    return t('Remove the Disk-only file after saving a local recovery copy.');
  if (entry.action === 'upload')
    return entry.remoteHash
      ? t('Replace the cloud version with this device’s version.')
      : entry.baseline
        ? t('Restore the missing file on Yandex Disk.')
        : t('Create this file on Yandex Disk.');
  if (entry.action === 'download')
    return entry.localHash
      ? t('Replace this device’s version with the cloud version.')
      : entry.baseline
        ? t('Restore the missing file on this device.')
        : t('Create this file on this device.');
  return entry.message ?? '';
}
