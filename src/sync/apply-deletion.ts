import { t } from '../i18n';
import type { LogSink } from '../logging/log';
import { preserveVersion } from './recovery';
import type { PlanEntry, Snapshot, SyncResult, SyncState, SyncStore } from './types';

export async function applyDeletion(
  local: SyncStore,
  remote: SyncStore,
  entry: PlanEntry,
  here: Snapshot | undefined,
  there: Snapshot | undefined,
  state: SyncState,
  result: SyncResult,
  checkActive: () => void,
  log: LogSink,
): Promise<void> {
  const explicit = entry.resolution?.kind === 'delete';
  const versions = [
    {
      store: remote,
      victim: explicit || entry.action === 'delete-remote' ? there : undefined,
      local: false,
    },
    {
      store: local,
      victim: explicit || entry.action === 'delete-local' ? here : undefined,
      local: true,
    },
  ];

  if (!explicit && (entry.action === 'delete-local' ? !here || there : !there || here))
    throw new Error(t('Deletion preconditions changed. Prepare a new preview.'));
  if (versions.some(({ store, victim }) => victim && !store.remove))
    throw new Error(t('Deletion preconditions changed. Prepare a new preview.'));

  for (const { victim } of versions) {
    if (victim) await preserveVersion(local, victim);
  }

  for (const { store, victim, local: deletingLocal } of versions) {
    if (!victim || !store.remove) continue;
    checkActive();
    await store.remove(entry.path, victim);
    if (deletingLocal) result.deletedLocal = (result.deletedLocal ?? 0) + 1;
    else result.deletedRemote = (result.deletedRemote ?? 0) + 1;
    log('info', deletingLocal ? t('Deleted device file') : t('Deleted cloud file'), {
      path: entry.path,
      recoveryHash: victim.hash,
    });
  }

  delete state.hashes[entry.path];
}
