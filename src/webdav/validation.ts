import { t } from '../i18n';
import { MAX_FILE_BYTES } from '../shared/paths';
import type { Snapshot } from '../sync/types';
import { normalizeETag } from './etag';

export function validateFileWrite(
  data: ArrayBuffer,
  expected: Snapshot | undefined,
): Record<string, string> {
  if (data.byteLength > MAX_FILE_BYTES) throw new Error(t('File exceeds the 50 MiB limit.'));
  if (!expected) return { 'If-None-Match': '*' };
  const revision = normalizeETag(expected.revision);
  if (!revision) {
    throw new Error(
      t('The server did not return a strong ETag; a safe overwrite is not possible.'),
    );
  }
  return { 'If-Match': revision };
}

export function readETag(headers: Record<string, string>): string | undefined {
  return normalizeETag(
    Object.entries(headers).find(([name]) => name.toLowerCase() === 'etag')?.[1],
  );
}
