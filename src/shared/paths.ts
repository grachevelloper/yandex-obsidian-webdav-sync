import { t } from '../i18n';
export const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MiB
const MAX_FILENAME_BYTES = 255;
const EDGE_SLASHES = /^\/+|\/+$/gu;
const UNICODE_CANONICAL_FORM = 'NFC';

export function validatePath(path: string): string {
  if (!path || path.startsWith('/') || path.includes('\\') || /[\u0000-\u001f]/u.test(path)) {
    throw new Error(t('Unsafe path: {0}', { '0': path }));
  }

  if (path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(t('Unsafe path: {0}', { '0': path }));
  }

  return path;
}

export function isIncluded(path: string, configDir: string): boolean {
  validatePath(path);

  return (
    path !== configDir &&
    !path.startsWith(`${configDir}/`) &&
    !path.split('/').some((part) => part.startsWith('.'))
  );
}

export function isMirrorServicePath(path: string): boolean {
  const normalized = path.toLowerCase();

  return ['plugins/yandex-disk-sync', 'sync engine logs', 'webdav sync logs'].some(
    (folder) => normalized === folder || normalized.startsWith(`${folder}/`),
  );
}

export function validateRemoteFolder(value: string): string {
  const folder = value.trim().replace(EDGE_SLASHES, '');

  return validatePath(folder);
}

export function parentPath(path: string): string {
  const separatorIndex = path.lastIndexOf('/');

  return separatorIndex < 0 ? '' : path.slice(0, separatorIndex);
}

export function conflictPath(path: string, hash: string): string {
  const parent = parentPath(path);
  const name = path.slice(parent ? parent.length + 1 : 0);
  const dot = name.lastIndexOf('.');

  const encoder = new TextEncoder();
  const suffix = `.conflict-${hash}`;
  const availableBytes = MAX_FILENAME_BYTES - encoder.encode(suffix).length;

  const candidateExtension = dot > 0 ? name.slice(dot) : '';
  const firstCharacterBytes = encoder.encode(Array.from(name)[0]).length;
  const extension =
    encoder.encode(candidateExtension).length + firstCharacterBytes <= availableBytes
      ? candidateExtension
      : '';

  const originalStem = extension ? name.slice(0, dot) : name;
  const stemBudget = availableBytes - encoder.encode(extension).length;
  let stem = '';
  let stemBytes = 0;

  for (const character of originalStem) {
    const size = encoder.encode(character).length;
    if (stemBytes + size > stemBudget) break;

    stem += character;
    stemBytes += size;
  }

  return `${parent ? `${parent}/` : ''}${stem}${suffix}${extension}`;
}

export function validateFilePaths(paths: Iterable<string>): void {
  const names = new Map<string, string>();
  const files = new Set(paths);

  for (const path of files) {
    validatePath(path);

    const parts = path.split('/');

    for (let length = 1; length <= parts.length; length++) {
      const prefix = parts.slice(0, length).join('/');
      const key = prefix.normalize(UNICODE_CANONICAL_FORM).toLowerCase();
      const existing = names.get(key);

      if (existing && existing !== prefix) {
        throw new Error(
          t('Path collision on case-insensitive devices: {0} / {1}', {
            '0': existing,
            '1': prefix,
          }),
        );
      }

      if (length < parts.length && files.has(prefix)) {
        throw new Error(t('Path is used as both a file and a folder: {0}', { '0': prefix }));
      }

      names.set(key, prefix);
    }
  }
}
