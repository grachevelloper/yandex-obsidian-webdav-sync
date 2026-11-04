import type { LogSink } from '../logging/log';
import { parentPath, validatePath, validateRemoteFolder } from '../shared/paths';
import { ChangedDuringSync } from '../sync/errors';
import { snapshot } from '../sync/snapshot';
import type { FileEntry, Snapshot, SyncStore } from '../sync/types';
import { WebDavClient, requireStatus, type Connection, type HttpClient } from './client';
import { WebDavFolders } from './folders';
import { HTTP_STATUS } from './protocol';
import { readETag, validateFileWrite } from './validation';
import type { RequestOptions } from './request-scheduler';

export class WebDavStore implements SyncStore {
  private readonly root: string;
  private readonly client: WebDavClient;
  private readonly folders: WebDavFolders;

  constructor(
    connection: Connection,
    http: HttpClient,
    private readonly include: (path: string) => boolean,
    log?: LogSink,
    options: RequestOptions = {},
  ) {
    this.root = validateRemoteFolder(connection.folder);
    this.client = new WebDavClient(connection, http, log, options);
    this.folders = new WebDavFolders(this.client, this.root, include);
  }

  list(): Promise<FileEntry[]> {
    return this.folders.listFiles();
  }

  async read(path: string): Promise<Snapshot | undefined> {
    const fullPath = this.fullPath(path);
    if (this.folders.has(fullPath)) throw new Error(`A folder exists instead of a file: ${path}`);
    const response = await this.client.request('GET', fullPath);
    if (response.status === HTTP_STATUS.NOT_FOUND) return undefined;
    requireStatus(response, [HTTP_STATUS.OK]);
    return snapshot(response.arrayBuffer, readETag(response.headers));
  }

  async write(path: string, data: ArrayBuffer, expected: Snapshot | undefined): Promise<void> {
    const conditions = validateFileWrite(data, expected);
    const fullPath = this.fullPath(path);
    await this.folders.ensure(parentPath(fullPath));
    const response = await this.client.request(
      'PUT',
      fullPath,
      { 'Content-Type': 'application/octet-stream', ...conditions },
      data,
    );
    if (
      response.status === HTTP_STATUS.CONFLICT ||
      response.status === HTTP_STATUS.PRECONDITION_FAILED
    ) {
      throw new ChangedDuringSync(path);
    }
    requireStatus(response, [HTTP_STATUS.OK, HTTP_STATUS.CREATED, HTTP_STATUS.NO_CONTENT]);
  }

  private fullPath(path: string): string {
    validatePath(path);
    if (!this.include(path))
      throw new Error('Configuration files are excluded from synchronization.');
    return `${this.root}/${path}`;
  }
}
