import { checkCancellation, ChangedDuringSync } from './errors';
import type { PlanEntry, Snapshot, SyncStore } from './types';

export interface FileVersions {
  local?: Snapshot;
  remote?: Snapshot;
}

export type FileLoader = (entry: PlanEntry) => Promise<FileVersions>;

export async function loadFile(
  local: SyncStore,
  remote: SyncStore,
  entry: PlanEntry,
  signal?: AbortSignal,
): Promise<FileVersions> {
  checkCancellation(signal);
  const [here, there] = await Promise.all([local.read(entry.path), remote.read(entry.path)]);
  checkCancellation(signal);
  if ((!here && !there) || here?.hash !== entry.localHash || there?.hash !== entry.remoteHash)
    throw new ChangedDuringSync(entry.path);
  return { local: here, remote: there };
}
