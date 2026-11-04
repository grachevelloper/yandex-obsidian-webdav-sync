import { t } from '../i18n';
import type { SyncResult } from './types';

export class ChangedDuringSync extends Error {
  constructor(path: string) {
    super(t('File changed during synchronization: {0}. Run sync again.', { '0': path }));
  }
}

export class SyncInterrupted extends Error {}

export class SyncCancelled extends SyncInterrupted {
  result?: SyncResult;

  constructor() {
    super(t('Sync cancelled by user. Completed changes are kept.'));
  }
}

export function checkCancellation(signal?: AbortSignal): void {
  if (signal?.aborted) throw new SyncCancelled();
}
