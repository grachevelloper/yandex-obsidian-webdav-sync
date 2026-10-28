import type { LogSink } from '../logging/log';
import { conflictPath, MAX_FILE_BYTES, validateFilePaths } from '../shared/paths';
import { decideChange } from './decisions';
import { ChangedDuringSync } from './errors';
import type { Snapshot, SyncResult, SyncState, SyncStore } from './types';

export async function synchronize(
  local: SyncStore,
  remote: SyncStore,
  state: SyncState,
  checkpoint: () => Promise<void>,
  progress: (path: string) => void = () => {},
  log: LogSink = () => {},
): Promise<SyncResult> {
  const [localFiles, remoteFiles] = await Promise.all([local.list(), remote.list()]);
  const sizes = new Map<string, number>();

  for (const file of [...localFiles, ...remoteFiles]) {
    sizes.set(file.path, Math.max(sizes.get(file.path) ?? 0, file.size));
  }

  validateFilePaths(sizes.keys());

  const result: SyncResult = { uploaded: 0, downloaded: 0, conflicts: [], skipped: [], errors: [] };

  for (const [path, size] of [...sizes].sort(([a], [b]) => a.localeCompare(b))) {
    progress(path);
    if (size > MAX_FILE_BYTES) {
      result.skipped.push(path);
      log('info', 'Skipped file exceeding the 50 MiB limit', { path, size });
      continue;
    }

    try {
      const [here, there] = await Promise.all([local.read(path), remote.read(path)]);
      const previous = Object.hasOwn(state.hashes, path) ? state.hashes[path] : undefined;
      const change = decideChange(here, there, previous);

      switch (change.kind) {
        case 'missing':
          continue;
        case 'unchanged':
          state.hashes[path] = change.hash;
          break;
        case 'upload':
          await remote.write(path, change.local.data, change.remote);
          state.hashes[path] = change.local.hash;
          result.uploaded++;
          log('info', 'Uploaded file', { path });
          break;
        case 'download':
          await local.write(path, change.remote.data, change.local);
          state.hashes[path] = change.remote.hash;
          result.downloaded++;
          log('info', 'Downloaded file', { path });
          break;
        case 'conflict': {
          const copyPath = conflictPath(path, change.local.hash);

          // An interrupted conflict upload must leave the original untouched, so save both copies first.
          await ensureCopy(local, copyPath, change.local);
          await ensureCopy(remote, copyPath, change.local);
          await local.write(path, change.remote.data, change.local);

          state.hashes[copyPath] = change.local.hash;
          state.hashes[path] = change.remote.hash;
          result.conflicts.push({ path, copyPath });
          result.uploaded++;
          result.downloaded++;
          log('info', 'Preserved both conflicting versions on both sides', { path, copyPath });
          break;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`${path}: ${message}`);
      log('error', message, { path });
      continue;
    }

    // A persistence failure stops the run; file failures can safely be retried independently.
    await checkpoint();
  }

  return result;
}

async function ensureCopy(store: SyncStore, path: string, source: Snapshot): Promise<void> {
  const existing = await store.read(path);
  if (existing?.hash === source.hash) return;
  if (existing) throw new ChangedDuringSync(path);
  await store.write(path, source.data, undefined);
}
