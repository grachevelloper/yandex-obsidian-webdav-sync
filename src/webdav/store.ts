import { t } from '../i18n';
import type { RemoteCache } from '../sync/remote-cache';
import type { LogSink } from '../logging/log';
import { parentPath, validatePath, validateRemoteFolder } from '../shared/paths';
import { ChangedDuringSync } from '../sync/errors';
import { snapshot } from '../sync/snapshot';
import type { FileEntry, FileVersion, Snapshot, SyncStore } from '../sync/types';
import { WebDavClient, requireStatus, type Connection, type HttpClient } from './client';
import { WebDavFolders } from './folders';
import { HTTP_STATUS } from './protocol';
import { normalizeETag } from './etag';
import { readETag, validateFileWrite } from './validation';
import type { RequestOptions } from './request-scheduler';

export class WebDavStore implements SyncStore {
  private readonly root: string;
  private readonly client: WebDavClient;
  private readonly folders: WebDavFolders;
  private readonly cache?: RemoteCache;
  private listedFiles?: Map<string, FileEntry>;

  constructor(
    connection: Connection,
    http: HttpClient,
    private readonly include: (path: string) => boolean,
    private readonly log: LogSink = () => {},
    options: RequestOptions = {},
    cache?: RemoteCache,
    private readonly requireExistingRoot = false,
  ) {
    this.root = validateRemoteFolder(connection.folder);
    this.client = new WebDavClient(connection, http, log, options);
    this.folders = new WebDavFolders(this.client, this.root, include);
    if (cache?.scope === JSON.stringify([connection.login.trim(), this.root])) this.cache = cache;
  }

  async list(): Promise<FileEntry[]> {
    this.listedFiles = undefined;
    const files = await this.folders.listFiles(this.requireExistingRoot);
    this.listedFiles = new Map(files.map((file) => [file.path, file]));
    this.pruneCache();
    return files;
  }

  async inspect(path: string): Promise<FileVersion | undefined> {
    this.fullPath(path);
    const listed = this.listedFiles?.get(path);
    const cached = this.cache?.files[path];
    if (listed?.revision && cached?.etag === listed.revision && cached.size === listed.size) {
      this.log('info', t('Reused cached cloud version'), { path });
      return { hash: cached.hash, revision: cached.etag };
    }
    return this.read(path);
  }

  async read(path: string): Promise<Snapshot | undefined> {
    const fullPath = this.fullPath(path);
    if (this.folders.has(fullPath))
      throw new Error(t('A folder exists instead of a file: {0}', { '0': path }));
    const response = await this.client.request('GET', fullPath, {
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    });
    if (response.status === HTTP_STATUS.NOT_FOUND) {
      this.invalidate(path);
      return undefined;
    }
    requireStatus(response, [HTTP_STATUS.OK]);
    const file = await snapshot(response.arrayBuffer, readETag(response.headers));
    this.remember(path, file);
    return file;
  }

  async write(path: string, data: ArrayBuffer, expected: Snapshot | undefined): Promise<void> {
    const conditions = validateFileWrite(data, expected);
    this.invalidate(path);
    const fullPath = this.fullPath(path);
    await this.folders.ensure(parentPath(fullPath));
    const response = await this.client.request(
      'PUT',
      fullPath,
      { 'Content-Type': 'application/octet-stream', ...conditions },
      data,
    );
    this.requireWritePrecondition(response.status, path, 'PUT', conditions);
    if (response.status === HTTP_STATUS.CONFLICT) {
      throw new ChangedDuringSync(path);
    }
    requireStatus(response, [HTTP_STATUS.OK, HTTP_STATUS.CREATED, HTTP_STATUS.NO_CONTENT]);
    const revision = readETag(response.headers);
    if (revision) this.remember(path, await snapshot(data, revision));
  }

  async remove(path: string, expected: Snapshot): Promise<void> {
    const fullPath = this.fullPath(path);
    const revision = normalizeETag(expected.revision);
    if (!revision) throw new Error(t('A strong cloud ETag is required before deleting a file.'));
    if (this.folders.has(fullPath)) throw new Error(t('Folder deletion is not supported.'));

    this.invalidate(path);
    const conditions = { 'If-Match': revision };
    const response = await this.client.request('DELETE', fullPath, conditions);
    this.requireWritePrecondition(response.status, path, 'DELETE', conditions);
    if (response.status === HTTP_STATUS.NOT_FOUND) throw new ChangedDuringSync(path);
    requireStatus(response, [HTTP_STATUS.NO_CONTENT, HTTP_STATUS.OK]);
  }

  private requireWritePrecondition(
    status: number,
    path: string,
    method: 'PUT' | 'DELETE',
    conditions: Record<string, string>,
  ): void {
    if (status !== HTTP_STATUS.PRECONDITION_FAILED) return;

    this.log('error', t('Yandex Disk rejected the write precondition'), {
      path,
      method,
      status,
      ...conditions,
    });
    throw new Error(
      t('Yandex Disk rejected the file version check (HTTP 412): {0}. Prepare a new preview.', {
        '0': path,
      }),
    );
  }

  private remember(path: string, file: Snapshot): void {
    if (!this.cache) return;
    if (file.revision)
      this.cache.files[path] = { etag: file.revision, hash: file.hash, size: file.data.byteLength };
    else this.invalidate(path);
  }

  private invalidate(path: string): void {
    if (this.cache) delete this.cache.files[path];
  }

  private pruneCache(): void {
    if (!this.cache) return;
    for (const [path, cached] of Object.entries(this.cache.files)) {
      const listed = this.listedFiles?.get(path);
      if (!listed?.revision || listed.revision !== cached.etag || listed.size !== cached.size)
        this.invalidate(path);
    }
  }

  private fullPath(path: string): string {
    validatePath(path);
    if (!this.include(path))
      throw new Error(t('Configuration files are excluded from synchronization.'));
    return `${this.root}/${path}`;
  }
}
