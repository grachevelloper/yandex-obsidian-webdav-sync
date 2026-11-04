import { decideChange } from './decisions';
import type { FileVersion, PlanEntry, SyncMode } from './types';

export function planAction(
  mode: SyncMode,
  local: FileVersion | undefined,
  remote: FileVersion | undefined,
  baseline: string | undefined,
): PlanEntry['action'] {
  if (mode === 'two-way') return decideChange(local, remote, baseline).kind;

  const source = mode === 'device-wins' ? local : remote;
  const destination = mode === 'device-wins' ? remote : local;
  if (!source) return mode === 'device-wins' ? 'delete-remote' : 'delete-local';
  if (source.hash === destination?.hash) return 'unchanged';
  return mode === 'device-wins' ? 'upload' : 'download';
}
