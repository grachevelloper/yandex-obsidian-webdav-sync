import { t } from '../i18n';
import type { LogSink } from '../logging/log';
import { conflictPath, MAX_FILE_BYTES, validateFilePaths } from '../shared/paths';
import { checkCancellation, SyncInterrupted } from './errors';
import { runConcurrent } from './concurrency';
import { FileProgress, type ProgressSink } from './progress';
import { planAction } from './modes';
import { prepareTextMerge } from './text-merge';
import { detectMoves } from './detect-moves';
import type { PlanEntry, SyncPlan, SyncState, SyncStore, SyncMode } from './types';

export async function planSync(
  local: SyncStore,
  remote: SyncStore,
  state: SyncState,
  progress: ProgressSink = () => {},
  log: LogSink = () => {},
  concurrency = 1,
  signal?: AbortSignal,
  mode: SyncMode = 'two-way',
): Promise<SyncPlan> {
  checkCancellation(signal);
  progress({ phase: 'listing', processed: 0, activePaths: [] });
  const [localFiles, remoteFiles] = await Promise.all([local.list(), remote.list()]);
  checkCancellation(signal);
  const sizes = new Map<string, number>();

  for (const file of [...localFiles, ...remoteFiles]) {
    sizes.set(file.path, Math.max(sizes.get(file.path) ?? 0, file.size));
  }
  validateFilePaths(sizes.keys());
  const localPaths = new Set(localFiles.map((file) => file.path));
  const remotePaths = new Set(remoteFiles.map((file) => file.path));

  const entries: PlanEntry[] = [];
  const tracker = new FileProgress('preview', sizes.size, progress);
  await runConcurrent(
    [...sizes].sort(([a], [b]) => a.localeCompare(b)),
    concurrency,
    async ([path, size], index) => {
      checkCancellation(signal);
      tracker.start(path);
      try {
        const baseline = Object.hasOwn(state.hashes, path) ? state.hashes[path] : undefined;
        if (size > MAX_FILE_BYTES) {
          entries[index] = {
            path,
            action: mode === 'two-way' ? 'skip' : 'error',
            baseline,
            message: t('File exceeds the 50 MiB limit.'),
          };
          return;
        }

        try {
          const [here, there] = await Promise.all([
            local.read(path),
            remote.inspect ? remote.inspect(path) : remote.read(path),
          ]);
          checkCancellation(signal);
          if ((localPaths.has(path) && !here) || (remotePaths.has(path) && !there))
            throw new Error(t('A listed file disappeared. Prepare a new preview.'));
          let action = planAction(mode, here, there, baseline);
          const merge =
            action === 'conflict' && baseline && here && there
              ? await prepareTextMerge(local, remote, path, baseline, here, there.hash)
              : undefined;
          checkCancellation(signal);
          if (merge && merge.every((chunk) => 'text' in chunk)) action = 'merge';
          entries[index] = {
            path,
            action,
            baseline,
            localHash: here?.hash,
            remoteHash: there?.hash,
            ...(merge ? { merge } : {}),
            ...(action === 'conflict' && here ? { copyPath: conflictPath(path, here.hash) } : {}),
          };
        } catch (error) {
          if (error instanceof SyncInterrupted) throw error;
          const message = error instanceof Error ? error.message : t('Unknown error');
          entries[index] = { path, action: 'error', baseline, message };
          log('error', message, { path });
        }
      } finally {
        tracker.finish(path);
      }
    },
  );

  checkCancellation(signal);
  log('info', t('Prepared read-only sync preview'), { files: entries.length });
  return { scope: state.scope, mode, entries: mode === 'two-way' ? detectMoves(entries) : entries };
}
