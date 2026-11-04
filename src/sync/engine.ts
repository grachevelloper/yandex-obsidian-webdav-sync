import type { LogSink } from '../logging/log';
import { conflictPath, validateFilePaths } from '../shared/paths';
import { runConcurrent, PathQueue } from './concurrency';
import { ChangedDuringSync, SyncInterrupted } from './errors';
import { FileProgress, type ProgressSink } from './progress';
import { planSync } from './plan';
import type { Snapshot, SyncPlan, SyncResult, SyncState, SyncStore } from './types';

export async function synchronize(
  local: SyncStore,
  remote: SyncStore,
  state: SyncState,
  checkpoint: () => Promise<void>,
  progress: ProgressSink = () => {},
  log: LogSink = () => {},
  concurrency = 1,
): Promise<SyncResult> {
  const plan = await planSync(local, remote, state, progress, log, concurrency);
  return executePlan(local, remote, state, plan, checkpoint, progress, log, concurrency);
}

export async function executePlan(
  local: SyncStore,
  remote: SyncStore,
  state: SyncState,
  plan: SyncPlan,
  checkpoint: () => Promise<void>,
  progress: ProgressSink = () => {},
  log: LogSink = () => {},
  concurrency = 1,
): Promise<SyncResult> {
  if (plan.scope !== state.scope) throw new Error('The connection changed. Prepare a new preview.');
  if (plan.entries.some((entry) => entry.action === 'error')) {
    throw new Error('The preview is incomplete. Resolve its errors and prepare a new preview.');
  }
  if (
    plan.entries.some(
      (entry) =>
        (Object.hasOwn(state.hashes, entry.path) ? state.hashes[entry.path] : undefined) !==
        entry.baseline,
    )
  ) {
    throw new Error('Sync state changed. Prepare a new preview.');
  }
  validateFilePaths(plan.entries.map(({ path }) => path));

  const result: SyncResult = { uploaded: 0, downloaded: 0, conflicts: [], skipped: [], errors: [] };

  const tracker = new FileProgress('sync', plan.entries.length, progress);
  const pathQueue = new PathQueue();
  let checkpointQueue = Promise.resolve();
  await runConcurrent(plan.entries, concurrency, async (entry, _index, checkActive) => {
    await pathQueue.run(entry.copyPath ? [entry.path, entry.copyPath] : [entry.path], async () => {
      checkActive();
      const { path, action } = entry;
      tracker.start(path);
      try {
        if (action === 'skip') {
          result.skipped.push(path);
          log('info', 'Skipped file exceeding the 50 MiB limit', { path });
          return;
        }
        if (action === 'missing') return;
        if (action === 'unchanged') {
          if (entry.localHash) state.hashes[path] = entry.localHash;
        } else {
          try {
            const [here, there] = await Promise.all([local.read(path), remote.read(path)]);
            checkActive();
            const desiredHash = action === 'upload' ? entry.localHash : entry.remoteHash;

            // A prior conflict in this run may already have created an approved copy at this path.
            const alreadyApplied =
              action !== 'conflict' &&
              desiredHash !== undefined &&
              here?.hash === desiredHash &&
              there?.hash === desiredHash;
            if (
              !alreadyApplied &&
              (here?.hash !== entry.localHash || there?.hash !== entry.remoteHash)
            ) {
              throw new Error(
                'File changed since the preview. Prepare a new preview before syncing it.',
              );
            }

            if (alreadyApplied) {
              state.hashes[path] = desiredHash;
            } else if (action === 'upload' && here) {
              await remote.write(path, here.data, there);
              state.hashes[path] = here.hash;
              result.uploaded++;
              log('info', 'Uploaded file', { path });
            } else if (action === 'download' && there) {
              await local.write(path, there.data, here);
              state.hashes[path] = there.hash;
              result.downloaded++;
              log('info', 'Downloaded file', { path });
            } else if (action === 'conflict' && here && there) {
              const copyPath = conflictPath(path, here.hash);
              if (copyPath !== entry.copyPath)
                throw new Error('Conflict path changed. Prepare a new preview.');

              // An interrupted conflict upload must leave the original untouched, so save both copies first.
              await ensureCopy(local, copyPath, here, checkActive);
              await ensureCopy(remote, copyPath, here, checkActive);
              checkActive();
              await local.write(path, there.data, here);

              state.hashes[copyPath] = here.hash;
              state.hashes[path] = there.hash;
              result.conflicts.push({ path, copyPath });
              result.uploaded++;
              result.downloaded++;
              log('info', 'Preserved both conflicting versions on both sides', { path, copyPath });
            } else {
              throw new Error('Invalid sync preview. Prepare a new preview.');
            }
          } catch (error) {
            if (error instanceof SyncInterrupted) throw error;
            checkActive();
            const message = error instanceof Error ? error.message : 'Unknown error';
            result.errors.push(`${path}: ${message}`);
            log('error', message, { path });
            return;
          }
        }

        // A persistence failure stops the run; file failures can safely be retried independently.
        checkActive();
        checkpointQueue = checkpointQueue.then(() => {
          checkActive();
          return checkpoint();
        });
        await checkpointQueue;
      } finally {
        tracker.finish(path);
      }
    });
  });

  return result;
}

async function ensureCopy(
  store: SyncStore,
  path: string,
  source: Snapshot,
  checkActive: () => void,
): Promise<void> {
  const existing = await store.read(path);
  checkActive();
  if (existing?.hash === source.hash) return;
  if (existing) throw new ChangedDuringSync(path);
  await store.write(path, source.data, undefined);
}
