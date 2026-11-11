import { t, getLocale } from '../i18n';

import type { SyncProgress } from '../sync/progress';
import type { RunLog } from '../logging/log';

export function renderReport(
  container: HTMLElement,
  log: RunLog,
  openLog: () => void,
  progress?: SyncProgress,
  restoreCopy?: (path: string, hash: string) => Promise<string>,
): void {
  const fragment = container.ownerDocument.adoptNode(createFragment());
  const create = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    text?: string,
  ) => {
    return fragment.createEl(tag, { cls: className, text });
  };

  container.replaceChildren();
  container.classList.add('yds-report');
  const body = create('div', 'yds-report-body');
  container.append(body);
  const result = log.result;
  const needsAttention =
    log.outcome === 'failed' || log.outcome === 'partial' || Boolean(result?.conflicts.length);
  const headline = reportHeadline(log, needsAttention);
  const header = create('div', 'yds-header');
  header.append(
    create(
      'div',
      `yds-status ${needsAttention ? 'yds-status-attention' : ''}`,
      log.outcome === 'cancelled' ? '■' : needsAttention ? '!' : '✓',
    ),
  );
  const heading = create('div', 'yds-heading');
  heading.append(create('h2', 'yds-title', headline));
  header.append(heading);
  body.append(header);

  const date = new Date(log.finishedAt ?? log.startedAt).toLocaleString(getLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  body.append(create('p', 'yds-meta', date));
  if (log.outcome === 'cancelled')
    body.append(
      create(
        'p',
        'yds-description',
        t('Sync stopped. Completed changes are kept. Run a new preview to continue.'),
      ),
    );
  if (progress?.total !== undefined)
    body.append(
      create(
        'p',
        'yds-progress-count',
        t('{0} / {1} files processed', { '0': progress.processed, '1': progress.total }),
      ),
    );
  const metrics = create('div', 'yds-metrics');
  metrics.hidden = !result;
  metrics.setAttribute('aria-label', t('Sync totals'));
  const hasBreakdown =
    result &&
    [
      result.added,
      result.updated,
      result.restored,
      result.merged,
      result.moved,
      result.renamed,
    ].some((count) => count !== undefined);
  const breakdown = [
    [t('Added'), result?.added ?? 0, false],
    [t('Updated'), result?.updated ?? 0, false],
    [t('Restored'), result?.restored ?? 0, false],
    [t('Edits merged'), result?.merged ?? 0, false],
    [t('Moved'), result?.moved ?? 0, false],
    [t('Renamed'), result?.renamed ?? 0, false],
  ] as const;
  const transfers = hasBreakdown
    ? breakdown.filter(([, count]) => count > 0)
    : ([
        [t('Uploaded'), result?.uploaded ?? 0, false],
        [t('Downloaded'), result?.downloaded ?? 0, false],
      ] as const);
  for (const [label, value, attention] of [
    ...transfers,
    [t('Edited'), result?.edited ?? 0, false],
    [t('Resolved'), result?.resolved ?? 0, false],
    [t('Deleted locally'), result?.deletedLocal ?? 0, true],
    [t('Deleted on Disk'), result?.deletedRemote ?? 0, true],
    [t('Conflicts'), result?.conflicts.length ?? 0, true],
    [t('Skipped'), result?.skipped.length ?? 0, true],
    [t('Errors'), (result?.errors.length ?? 0) + (log.failure ? 1 : 0), true],
  ] as const) {
    if (
      value === 0 &&
      (label === t('Edited') ||
        label === t('Resolved') ||
        label === t('Deleted locally') ||
        label === t('Deleted on Disk'))
    )
      continue;
    const card = create('div', `yds-stat${attention && value ? ' yds-stat-attention' : ''}`);
    card.append(
      create('strong', 'yds-stat-value', String(value)),
      create('span', 'yds-stat-label', label),
    );
    metrics.append(card);
  }
  body.append(metrics);

  if (log.failure) body.append(create('p', 'yds-failure', log.failure));
  if (result?.conflicts.length) {
    const section = create('section', 'yds-section');
    section.append(
      create('h3', 'yds-section-title', t('Both versions are safe')),
      create(
        'p',
        'yds-description',
        t(
          'The cloud version keeps the original name. Your local edit is saved beside it. Both files are now on this device and Yandex Disk.',
        ),
      ),
    );
    for (const conflict of result.conflicts) {
      const pair = create('div', 'yds-conflict');
      for (const [label, path] of [
        [t('Cloud version'), conflict.path],
        [t('Local version'), conflict.copyPath],
      ]) {
        const row = create('div', 'yds-version');
        row.append(create('span', 'yds-version-label', label), create('code', 'yds-path', path));
        pair.append(row);
      }
      section.append(pair);
    }
    body.append(section);
  }

  for (const [title, items, expanded] of [
    [t('Errors · resolve the cause and run sync again'), result?.errors ?? [], true],
    [t('Skipped · left unchanged'), result?.skipped ?? [], false],
  ] as const) {
    if (!items.length) continue;
    const details = create('details', 'yds-details');
    details.open = expanded;
    details.append(create('summary', 'yds-section-title', title));
    const list = create('ul', 'yds-issues');
    for (const item of items) list.append(create('li', '', item));
    details.append(list);
    body.append(details);
  }

  if (restoreCopy) {
    const recovery = create('details', 'yds-details');
    recovery.append(create('summary', 'yds-section-title', t('Previous versions')));
    const versions = new Set<string>();
    for (const { details } of log.events) {
      const path = details?.path;
      const hash = details?.recoveryHash;
      const side = details?.side;
      if (typeof path !== 'string' || typeof hash !== 'string') continue;
      const key = JSON.stringify([path, hash]);
      if (versions.has(key)) continue;
      versions.add(key);

      const row = create('div', 'yds-recovery-row');
      const info = create('div', '');
      const location =
        side === 'local' ? t('Local version') : side === 'remote' ? t('Cloud version') : '';
      info.append(create('div', 'yds-path', path), create('div', 'yds-description', location));
      const action = create('button', '', t('Restore a copy'));
      action.type = 'button';
      action.setAttribute('aria-label', t('Restore a copy of {0}', { '0': path }));
      const status = create('span', 'yds-description');
      status.setAttribute('aria-live', 'polite');
      action.addEventListener('click', () => {
        action.disabled = true;
        void restoreCopy(path, hash).then(
          (target) => {
            status.textContent = t('Copy saved on this device: {0}', { '0': target });
          },
          (error: unknown) => {
            status.textContent =
              error instanceof Error ? error.message : t('The previous version is unavailable.');
            action.disabled = false;
          },
        );
      });
      row.append(info, action, status);
      recovery.append(row);
    }
    if (versions.size) {
      recovery.append(
        create('p', 'yds-description', t('Restoring creates a separate file on this device.')),
      );
      body.append(recovery);
    }
  }

  const footer = create('div', 'yds-footer');
  const button = create('button', 'yds-log-button', t('View sync log'));
  button.type = 'button';
  button.addEventListener('click', openLog);
  footer.append(
    create('span', 'yds-footnote', t('Manual sync · changes confirmed in preview')),
    button,
  );
  container.append(footer);
}

function reportHeadline(log: RunLog, needsAttention: boolean): string {
  if (log.outcome === 'cancelled') return t('Sync cancelled');
  if (log.outcome === 'failed') return t('Sync stopped');
  if (log.result?.skipped.length && !log.result.errors.length && !log.result.conflicts.length)
    return t('Sync finished with skipped files');
  if (needsAttention) return t('A few things to review');
  if (
    log.result &&
    log.result.uploaded +
      log.result.downloaded +
      (log.result.deletedLocal ?? 0) +
      (log.result.deletedRemote ?? 0) +
      (log.result.resolved ?? 0) +
      (log.result.moved ?? 0) +
      (log.result.renamed ?? 0) ===
      0
  )
    return t('Everything is up to date');
  return t('Your files are in sync');
}
