import { t } from '../i18n';
import type { LogSink } from '../logging/log';
import { conflictPath, validateFilePaths } from '../shared/paths';
import { runConcurrent, PathQueue } from './concurrency';
import { checkCancellation, ChangedDuringSync, SyncCancelled, SyncInterrupted } from './errors';
import { FileProgress, type ProgressSink } from './progress';
import { applyDeletion } from './apply-deletion';
import { applyResolution } from './apply-resolution';
import { preserveVersion } from './recovery';
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
  signal?: AbortSignal,
): Promise<SyncResult> {
  checkCancellation(signal);
  if (plan.scope !== state.scope)
    throw new Error(t('The connection changed. Prepare a new preview.'));
  if (plan.entries.some((entry) => entry.action === 'error' && entry.resolution?.kind !== 'skip')) {
    throw new Error(t('The preview is incomplete. Resolve its errors and prepare a new preview.'));
  }
  if (
    plan.entries.some(
      (entry) =>
        (Object.hasOwn(state.hashes, entry.path) ? state.hashes[entry.path] : undefined) !==
        entry.baseline,
    )
  ) {
    throw new Error(t('Sync state changed. Prepare a new preview.'));
  }
  if (
    plan.entries.some(
      (entry) =>
        (entry.action === 'delete-local' && plan.mode !== 'cloud-wins') ||
        (entry.action === 'delete-remote' && plan.mode !== 'device-wins') ||
        (plan.mode === 'device-wins' &&
          (entry.action === 'download' || entry.action === 'conflict')) ||
        (plan.mode === 'cloud-wins' && (entry.action === 'upload' || entry.action === 'conflict')),
    )
  )
    throw new Error(t('The sync mode does not permit these deletion or transfer actions.'));
  validateFilePaths(plan.entries.map(({ path }) => path));

  const result: SyncResult = { uploaded: 0, downloaded: 0, conflicts: [], skipped: [], errors: [] };

  const tracker = new FileProgress('sync', plan.entries.length, progress);
  const pathQueue = new PathQueue();
  let checkpointQueue = Promise.resolve();
  const checkCheckpointActive = (checkActive: () => void) => {
    try {
      checkActive();
    } catch (error) {
      // A stopped parallel worker must not discard another worker's completed write.
      if (!(error instanceof SyncCancelled)) throw error;
    }
  };
  try {
    await runConcurrent(plan.entries, concurrency, async (entry, _index, checkActive) => {
      await pathQueue.run(
        entry.copyPath ? [entry.path, entry.copyPath] : [entry.path],
        async () => {
          checkActive();
          checkCancellation(signal);
          const { path, action } = entry;
          tracker.start(path);
          try {
            if (action === 'skip' || entry.resolution?.kind === 'skip') {
              result.skipped.push(path);
              log('info', t('Skipped file'), { path });
              return;
            }
            if (action === 'missing') return;
            if (action === 'unchanged' && !entry.resolution) {
              if (entry.localHash) state.hashes[path] = entry.localHash;
            } else {
              try {
                const [here, there] = await Promise.all([local.read(path), remote.read(path)]);
                checkActive();
                checkCancellation(signal);
                const desiredHash = action === 'upload' ? entry.localHash : entry.remoteHash;

                // A prior conflict in this run may already have created an approved copy at this path.
                const alreadyApplied =
                  !entry.resolution &&
                  (action === 'upload' || action === 'download') &&
                  desiredHash !== undefined &&
                  here?.hash === desiredHash &&
                  there?.hash === desiredHash;
                if (
                  !alreadyApplied &&
                  (here?.hash !== entry.localHash || there?.hash !== entry.remoteHash)
                ) {
                  throw new Error(
                    t('File changed since the preview. Prepare a new preview before syncing it.'),
                  );
                }

                const checkTransferActive = () => {
                  checkActive();
                  checkCancellation(signal);
                };
                if (entry.resolution && entry.resolution.kind !== 'delete') {
                  state.hashes[path] = await applyResolution(
                    local,
                    remote,
                    path,
                    entry.resolution,
                    here,
                    there,
                    result,
                    checkTransferActive,
                    log,
                  );
                  if (action === 'conflict') result.resolved = (result.resolved ?? 0) + 1;
                  else result.edited = (result.edited ?? 0) + 1;
                } else if (
                  entry.resolution?.kind === 'delete' ||
                  action === 'delete-local' ||
                  action === 'delete-remote'
                ) {
                  await applyDeletion(
                    local,
                    remote,
                    entry,
                    here,
                    there,
                    state,
                    result,
                    checkTransferActive,
                    log,
                  );
                } else if (alreadyApplied) {
                  state.hashes[path] = desiredHash;
                } else if (action === 'upload' && here) {
                  if (plan.mode === 'device-wins' && there) {
                    await preserveVersion(local, there);
                    checkTransferActive();
                    log('info', t('Saved cloud version before replacement'), {
                      path,
                      recoveryHash: there.hash,
                    });
                  }
                  await remote.write(path, here.data, there);
                  state.hashes[path] = here.hash;
                  result.uploaded++;
                  log('info', t('Uploaded file'), { path });
                } else if (action === 'download' && there) {
                  await local.write(path, there.data, here);
                  state.hashes[path] = there.hash;
                  result.downloaded++;
                  log('info', t('Downloaded file'), { path });
                } else if (action === 'conflict' && here && there) {
                  const copyPath = conflictPath(path, here.hash);
                  if (copyPath !== entry.copyPath)
                    throw new Error(t('Conflict path changed. Prepare a new preview.'));

                  // An interrupted conflict upload must leave the original untouched, so save both copies first.
                  const checkCopyActive = () => {
                    checkActive();
                    checkCancellation(signal);
                  };
                  await ensureCopy(local, copyPath, here, checkCopyActive);
                  await ensureCopy(remote, copyPath, here, checkCopyActive);
                  checkCopyActive();
                  await local.write(path, there.data, here);

                  state.hashes[copyPath] = here.hash;
                  state.hashes[path] = there.hash;
                  result.conflicts.push({ path, copyPath });
                  result.uploaded++;
                  result.downloaded++;
                  log('info', t('Preserved both conflicting versions on both sides'), {
                    path,
                    copyPath,
                  });
                } else {
                  throw new Error(t('Invalid sync preview. Prepare a new preview.'));
                }
              } catch (error) {
                if (error instanceof SyncInterrupted) throw error;
                checkActive();
                const message = error instanceof Error ? error.message : t('Unknown error');
                result.errors.push(`${path}: ${message}`);
                log('error', message, { path });
                return;
              }
            }

            // A persistence failure stops the run; file failures can safely be retried independently.
            checkCheckpointActive(checkActive);
            checkpointQueue = checkpointQueue.then(() => {
              checkCheckpointActive(checkActive);
              return checkpoint();
            });
            await checkpointQueue;
          } finally {
            tracker.finish(path);
          }
        },
      );
    });
    checkCancellation(signal);
  } catch (error) {
    if (error instanceof SyncCancelled) error.result = result;
    throw error;
  }

  return result;
}

async function ensureCopy(
  store: SyncStore,
  path: string,
  source: Snapshot,
  checkActive: () => void,
): Promise<void> {
  checkActive();
  const existing = await store.read(path);
  checkActive();
  if (existing?.hash === source.hash) return;
  if (existing) throw new ChangedDuringSync(path);
  await store.write(path, source.data, undefined);
}
