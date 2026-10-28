import { conflictPath, MAX_FILE_BYTES, validateFilePaths } from '../shared/paths';

export interface FileEntry {
  path: string;
  size: number;
}

export interface Snapshot {
  data: ArrayBuffer;
  hash: string;
  revision?: string;
}

export interface SyncStore {
  list(): Promise<FileEntry[]>;
  read(path: string): Promise<Snapshot | undefined>;
  write(path: string, data: ArrayBuffer, expected: Snapshot | undefined): Promise<void>;
}

export interface SyncState {
  version: 1;
  scope: string;
  hashes: Record<string, string>;
}

export class ChangedDuringSync extends Error {
  constructor(path: string) {
    super(`Файл изменился во время синхронизации: ${path}. Повторите запуск.`);
  }
}

export async function hashBytes(data: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function snapshot(data: ArrayBuffer, revision?: string): Promise<Snapshot> {
  if (data.byteLength > MAX_FILE_BYTES) {
    throw new Error('Файл превышает лимит 50 МиБ.');
  }

  return { data, hash: await hashBytes(data), revision };
}

export interface SyncResult {
  uploaded: number;
  downloaded: number;
  conflicts: string[];
  skipped: string[];
  errors: string[];
}

export async function synchronize(
  local: SyncStore,
  remote: SyncStore,
  state: SyncState,
  checkpoint: () => Promise<void>,
  progress: (path: string) => void = () => {},
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
      continue;
    }

    try {
      const [here, there] = await Promise.all([local.read(path), remote.read(path)]);
      const previous = Object.hasOwn(state.hashes, path) ? state.hashes[path] : undefined;

      if (!here && !there) continue;

      if (!there && here) {
        await remote.write(path, here.data, undefined);
        state.hashes[path] = here.hash;
        result.uploaded++;
      } else if (!here && there) {
        await local.write(path, there.data, undefined);
        state.hashes[path] = there.hash;
        result.downloaded++;
      } else if (here && there) {
        if (here.hash === there.hash) {
          state.hashes[path] = here.hash;
        } else if (previous === there.hash) {
          await remote.write(path, here.data, there);
          state.hashes[path] = here.hash;
          result.uploaded++;
        } else if (previous === here.hash) {
          await local.write(path, there.data, here);
          state.hashes[path] = there.hash;
          result.downloaded++;
        } else {
          const copyPath = conflictPath(path, here.hash);

          // An interrupted conflict upload must leave the original untouched, so save both copies first.
          await ensureCopy(local, copyPath, here);
          await ensureCopy(remote, copyPath, here);
          await local.write(path, there.data, here);

          state.hashes[copyPath] = here.hash;
          state.hashes[path] = there.hash;
          result.conflicts.push(path);
          result.uploaded++;
          result.downloaded++;
        }
      }
    } catch (error) {
      result.errors.push(
        `${path}: ${error instanceof Error ? error.message : 'Неизвестная ошибка'}`,
      );
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
