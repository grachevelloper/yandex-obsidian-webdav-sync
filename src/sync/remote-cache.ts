import { isObject } from '../shared/objects';
import { MAX_FILE_BYTES, validatePath } from '../shared/paths';
import { normalizeETag } from '../webdav/etag';

export interface CachedRemoteFile {
  etag: string;
  hash: string;
  size: number;
}

export interface RemoteCache {
  version: 1;
  scope: string;
  files: Record<string, CachedRemoteFile>;
}

export function emptyRemoteCache(scope: string): RemoteCache {
  const files: Record<string, CachedRemoteFile> = {};
  Object.setPrototypeOf(files, null);
  return { version: 1, scope, files };
}

export function loadRemoteCache(value: unknown): RemoteCache {
  if (
    !isObject(value) ||
    value.version !== 1 ||
    typeof value.scope !== 'string' ||
    !isObject(value.files)
  )
    return emptyRemoteCache('');
  const cache = emptyRemoteCache(value.scope);
  for (const [path, saved] of Object.entries(value.files)) {
    const entry = cachedRemoteFile(saved);
    if (entry && safePath(path)) cache.files[path] = entry;
  }
  return cache;
}

function cachedRemoteFile(value: unknown): CachedRemoteFile | undefined {
  if (!isObject(value)) return undefined;
  const etag = normalizeETag(value.etag);
  if (!etag || typeof value.hash !== 'string' || !/^[a-f0-9]{64}$/u.test(value.hash))
    return undefined;
  if (
    typeof value.size !== 'number' ||
    !Number.isSafeInteger(value.size) ||
    value.size < 0 ||
    value.size > MAX_FILE_BYTES
  )
    return undefined;
  return { etag, hash: value.hash, size: value.size };
}

function safePath(path: string): boolean {
  try {
    validatePath(path);
    return true;
  } catch {
    return false;
  }
}
