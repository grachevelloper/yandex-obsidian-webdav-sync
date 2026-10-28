import type { Snapshot } from './types';

type SyncChange =
  | { kind: 'missing' }
  | { kind: 'unchanged'; hash: string }
  | { kind: 'upload'; local: Snapshot; remote?: Snapshot }
  | { kind: 'download'; remote: Snapshot; local?: Snapshot }
  | { kind: 'conflict'; local: Snapshot; remote: Snapshot };

export function decideChange(
  local: Snapshot | undefined,
  remote: Snapshot | undefined,
  baseline: string | undefined,
): SyncChange {
  if (!local && !remote) return { kind: 'missing' };
  if (local && local.hash === remote?.hash) return { kind: 'unchanged', hash: local.hash };
  if (local && (!remote || baseline === remote.hash)) return { kind: 'upload', local, remote };
  if (remote && (!local || baseline === local.hash)) return { kind: 'download', remote, local };
  if (local && remote) return { kind: 'conflict', local, remote };
  throw new Error('Unexpected synchronization state.');
}
