import { t } from '../i18n';
import type { Snapshot, SyncStore } from './types';

export async function preserveVersion(local: SyncStore, file: Snapshot): Promise<void> {
  if (!local.preserve)
    throw new Error(t('Local recovery storage is unavailable. No replacement was made.'));
  await local.preserve(file);
}
