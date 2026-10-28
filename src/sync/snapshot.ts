import { MAX_FILE_BYTES } from '../shared/paths';
import type { Snapshot } from './types';

export async function hashBytes(data: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function snapshot(data: ArrayBuffer, revision?: string): Promise<Snapshot> {
  if (data.byteLength > MAX_FILE_BYTES) {
    throw new Error('File exceeds the 50 MiB limit.');
  }

  return { data, hash: await hashBytes(data), revision };
}
