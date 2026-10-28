export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export function validatePath(path: string): string {
  if (!path || path.startsWith('/') || path.includes('\\') || /[\u0000-\u001f]/u.test(path)) {
    throw new Error(`Небезопасный путь: ${path}`);
  }

  if (path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Небезопасный путь: ${path}`);
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

export function validateRemoteFolder(value: string): string {
  return validatePath(value.trim().replace(/^\/+|\/+$/gu, ''));
}

export function parentPath(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf('/')));
}

export function conflictPath(path: string, hash: string): string {
  const parent = parentPath(path);
  const name = path.slice(parent ? parent.length + 1 : 0);
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 && name.length - dot <= 20 ? name.slice(dot) : '';
  const stem = Array.from(extension ? name.slice(0, dot) : name)
    .slice(0, 30)
    .join('');

  return `${parent ? `${parent}/` : ''}${stem}.conflict-${hash}${extension}`;
}

export function validateFilePaths(paths: Iterable<string>): void {
  const names = new Map<string, string>();
  const files = new Set(paths);

  for (const path of files) {
    validatePath(path);
    const parts = path.split('/');

    for (let length = 1; length <= parts.length; length++) {
      const prefix = parts.slice(0, length).join('/');
      const key = prefix.normalize('NFC').toLowerCase();
      const existing = names.get(key);

      if (existing && existing !== prefix) {
        throw new Error(
          `Коллизия путей на устройствах без учёта регистра: ${existing} / ${prefix}`,
        );
      }
      if (length < parts.length && files.has(prefix)) {
        throw new Error(`Путь одновременно используется файлом и папкой: ${prefix}`);
      }

      names.set(key, prefix);
    }
  }
}
