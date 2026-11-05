import { t } from '../i18n';
import type { SyncProgress } from '../sync/progress';

export function renderProgress(container: HTMLElement) {
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
  container.classList.add('yds-progress');
  const count = create('p', 'yds-progress-count');
  const bar = create('div', 'yds-progress-bar');
  bar.tabIndex = -1;
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  const paths = create('ul', 'yds-active-files');
  paths.setAttribute('aria-label', t('Active files'));
  const activity = create('p', 'yds-progress-activity');
  const elapsed = create('span', 'yds-progress-elapsed');
  const footer = create('div', 'yds-progress-footer');
  const actions = create('div', 'yds-preview-actions');
  footer.append(elapsed, actions);
  container.append(
    count,
    bar,
    paths,
    activity,
    create(
      'p',
      'yds-progress-hint',
      t('Hide this window to keep working. Use Sync again to reopen it. Keep Obsidian open.'),
    ),
    footer,
  );
  let percent = 0;

  return {
    bar,
    activity,
    elapsed,
    actions,
    percent: () => percent,
    update(value: SyncProgress) {
      const listing = value.total === undefined;
      count.textContent = listing
        ? t('Listing folders…')
        : t('{0} / {1} files processed', { '0': value.processed, '1': value.total });
      percent = listing
        ? 0
        : value.total === 0
          ? 100
          : Math.round((100 * value.processed) / (value.total ?? 1));
      bar.setAttribute(
        'aria-label',
        value.phase === 'sync' ? t('Sync progress') : t('File check progress'),
      );
      if (listing) bar.removeAttribute('aria-valuenow');
      else bar.setAttribute('aria-valuenow', String(percent));
      bar.setAttribute('aria-valuetext', count.textContent);
      paths.replaceChildren(
        ...value.activePaths.map((path) => create('li', 'yds-active-file', path)),
      );
    },
  };
}
