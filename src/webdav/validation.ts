import { MAX_FILE_BYTES } from '../shared/paths';
import type { Snapshot } from '../sync/types';

const STRONG_ETAG = /^"[^"\r\n]*"$/u;

export function validateFileWrite(
  data: ArrayBuffer,
  expected: Snapshot | undefined,
): Record<string, string> {
  if (data.byteLength > MAX_FILE_BYTES) throw new Error('File exceeds the 50 MiB limit.');
  if (!expected) return { 'If-None-Match': '*' };
  if (!expected.revision || !STRONG_ETAG.test(expected.revision)) {
    throw new Error('The server did not return a strong ETag; a safe overwrite is not possible.');
  }
  return { 'If-Match': expected.revision };
}

export function readETag(headers: Record<string, string>): string | undefined {
  return Object.entries(headers).find(([name]) => name.toLowerCase() === 'etag')?.[1];
}
