import type { LogSink } from '../logging/log';
import { conflictPath, MAX_FILE_BYTES, validateFilePaths } from '../shared/paths';
import { SyncInterrupted } from './errors';
import { runConcurrent } from './concurrency';
import { decideChange } from './decisions';
import type { PlanEntry, SyncPlan, SyncState, SyncStore } from './types';

export async function planSync(
  local: SyncStore,
  remote: SyncStore,
  state: SyncState,
  progress: (path: string) => void = () => {},
  log: LogSink = () => {},
  concurrency = 1,
): Promise<SyncPlan> {
  const [localFiles, remoteFiles] = await Promise.all([local.list(), remote.list()]);
  const sizes = new Map<string, number>();

  for (const file of [...localFiles, ...remoteFiles]) {
    sizes.set(file.path, Math.max(sizes.get(file.path) ?? 0, file.size));
  }
  validateFilePaths(sizes.keys());

  const entries: PlanEntry[] = [];
  await runConcurrent(
    [...sizes].sort(([a], [b]) => a.localeCompare(b)),
    concurrency,
    async ([path, size], index) => {
      progress(path);
      const baseline = Object.hasOwn(state.hashes, path) ? state.hashes[path] : undefined;
      if (size > MAX_FILE_BYTES) {
        entries[index] = {
          path,
          action: 'skip',
          baseline,
          message: 'File exceeds the 50 MiB limit.',
        };
        return;
      }

      try {
        const [here, there] = await Promise.all([local.read(path), remote.read(path)]);
        const change = decideChange(here, there, baseline);
        entries[index] = {
          path,
          action: change.kind,
          baseline,
          localHash: here?.hash,
          remoteHash: there?.hash,
          ...(change.kind === 'conflict'
            ? { copyPath: conflictPath(path, change.local.hash) }
            : {}),
        };
      } catch (error) {
        if (error instanceof SyncInterrupted) throw error;
        const message = error instanceof Error ? error.message : 'Unknown error';
        entries[index] = { path, action: 'error', baseline, message };
        log('error', message, { path });
      }
    },
  );

  log('info', 'Prepared read-only sync preview', { files: entries.length });
  return { scope: state.scope, entries };
}
