import type { RunLog } from '../logging/log';

export function renderReport(container: HTMLElement, log: RunLog, openLog: () => void): void {
  const document = container.ownerDocument;
  const create = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    text?: string,
  ) => {
    const element = document.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };

  container.replaceChildren();
  container.classList.add('yds-report');
  const result = log.result;
  const needsAttention =
    log.outcome === 'failed' || log.outcome === 'partial' || Boolean(result?.conflicts.length);
  const headline = reportHeadline(log, needsAttention);
  const header = create('div', 'yds-header');
  header.append(
    create(
      'div',
      `yds-status ${needsAttention ? 'yds-status-attention' : ''}`,
      needsAttention ? '!' : '✓',
    ),
  );
  const heading = create('div', 'yds-heading');
  heading.append(
    create('p', 'yds-eyebrow', 'GRACHEVELOPER’S WEBDAV SYNC'),
    create('h2', 'yds-title', headline),
  );
  header.append(heading);
  container.append(header);

  const date = new Date(log.finishedAt ?? log.startedAt).toLocaleString('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  container.append(create('p', 'yds-meta', date));
  const metrics = create('div', 'yds-metrics');
  metrics.setAttribute('aria-label', 'Sync totals');
  for (const [label, value, attention] of [
    ['Uploaded', result?.uploaded ?? 0, false],
    ['Downloaded', result?.downloaded ?? 0, false],
    ['Conflicts', result?.conflicts.length ?? 0, true],
    ['Skipped', result?.skipped.length ?? 0, true],
    ['Errors', (result?.errors.length ?? 0) + (log.failure ? 1 : 0), true],
  ] as const) {
    const card = create('div', `yds-stat${attention && value ? ' yds-stat-attention' : ''}`);
    card.append(
      create('strong', 'yds-stat-value', String(value)),
      create('span', 'yds-stat-label', label),
    );
    metrics.append(card);
  }
  container.append(metrics);

  if (log.failure) container.append(create('p', 'yds-failure', log.failure));
  if (result?.conflicts.length) {
    const section = create('section', 'yds-section');
    section.append(
      create('h3', 'yds-section-title', 'Both versions are safe'),
      create(
        'p',
        'yds-description',
        'The cloud version keeps the original name. Your local edit is saved beside it. Both files are now on this device and Yandex Disk.',
      ),
    );
    for (const conflict of result.conflicts) {
      const pair = create('div', 'yds-conflict');
      for (const [label, path] of [
        ['Cloud version', conflict.path],
        ['Local version', conflict.copyPath],
      ]) {
        const row = create('div', 'yds-version');
        row.append(create('span', 'yds-version-label', label), create('code', 'yds-path', path));
        pair.append(row);
      }
      section.append(pair);
    }
    container.append(section);
  }

  for (const [title, items, expanded] of [
    ['Errors · resolve the cause and run sync again', result?.errors ?? [], true],
    ['Skipped · files exceed the 50 MiB limit', result?.skipped ?? [], false],
  ] as const) {
    if (!items.length) continue;
    const details = create('details', 'yds-details');
    details.open = expanded;
    details.append(create('summary', 'yds-section-title', title));
    const list = create('ul', 'yds-issues');
    for (const item of items) list.append(create('li', '', item));
    details.append(list);
    container.append(details);
  }

  const footer = create('div', 'yds-footer');
  const button = create('button', 'yds-log-button', 'View sync log');
  button.type = 'button';
  button.addEventListener('click', openLog);
  footer.append(create('span', 'yds-footnote', 'Manual sync · missing files are restored'), button);
  container.append(footer);
}

function reportHeadline(log: RunLog, needsAttention: boolean): string {
  if (log.outcome === 'cancelled') return 'Sync cancelled';
  if (log.outcome === 'failed') return 'Sync stopped';
  if (needsAttention) return 'A few things to review';
  if (log.result && log.result.uploaded + log.result.downloaded === 0)
    return 'Everything is up to date';
  return 'Your files are in sync';
}
