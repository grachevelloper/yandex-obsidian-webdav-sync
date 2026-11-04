import { t } from '../i18n';
import { SyncCancelled } from './errors';

export async function runConcurrent<T>(
  items: readonly T[],
  concurrency: number,
  process: (item: T, index: number, checkActive: () => void) => Promise<void>,
): Promise<void> {
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new Error(t('Invalid concurrency limit.'));
  const iterator = items.entries();
  let failed = false;
  let failure: unknown;
  const checkActive = () => {
    if (failed) throw failure;
  };

  async function worker(): Promise<void> {
    while (!failed) {
      const next = iterator.next();
      if (next.done) return;
      const [index, item] = next.value;
      try {
        await process(item, index, checkActive);
      } catch (error) {
        if (!failed || (failure instanceof SyncCancelled && !(error instanceof SyncCancelled))) {
          failed = true;
          failure = error;
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  checkActive();
}

export class PathQueue {
  private readonly pending = new Map<string, Promise<void>>();

  async run<T>(paths: string[], process: () => Promise<T>): Promise<T> {
    const keys = [...new Set(paths)];
    const previous = keys.map((path) => this.pending.get(path));
    let release = () => {};
    const done = new Promise<void>((resolve) => {
      release = resolve;
    });
    for (const path of keys) this.pending.set(path, done);
    await Promise.all(previous);

    try {
      return await process();
    } finally {
      release();
      for (const path of keys) if (this.pending.get(path) === done) this.pending.delete(path);
    }
  }
}
