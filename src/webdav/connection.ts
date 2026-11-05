import { t } from '../i18n';
import { validateRemoteFolder } from '../shared/paths';
import { WebDavClient, requireStatus, type Connection, type HttpClient } from './client';
import { parseListing } from './listing';
import { HTTP_STATUS, PROPFIND_PROPERTIES } from './protocol';
import type { RequestOptions } from './request-scheduler';

export async function checkConnection(
  connection: Connection,
  http: HttpClient,
  options: RequestOptions = {},
): Promise<{ folderExists: boolean }> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new Error(
            t('Connection check timed out after 30 seconds. Check your network and try again.'),
          ),
        );
        controller.abort();
      }, 30_000);
    });
    return await Promise.race([
      inspectConnection(connection, http, { ...options, signal: controller.signal }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
    options.signal?.removeEventListener('abort', abort);
  }
}

async function inspectConnection(
  connection: Connection,
  http: HttpClient,
  options: RequestOptions,
): Promise<{ folderExists: boolean }> {
  const folder = validateRemoteFolder(connection.folder);
  const client = new WebDavClient(connection, http, undefined, options);

  async function readFolder(path: string): Promise<boolean> {
    const response = await client.request(
      'PROPFIND',
      path,
      { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
      PROPFIND_PROPERTIES,
    );
    if (path && response.status === HTTP_STATUS.NOT_FOUND) return false;
    requireStatus(response, [HTTP_STATUS.MULTI_STATUS]);
    if (!parseListing(response.text, path).some((entry) => entry.path === '' && entry.directory)) {
      throw new Error(t('WebDAV did not confirm access to the folder.'));
    }
    return true;
  }

  await readFolder('');
  return { folderExists: await readFolder(folder) };
}
