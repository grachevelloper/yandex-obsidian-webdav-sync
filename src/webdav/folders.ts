import { t } from '../i18n';
import { parentPath } from '../shared/paths';
import type { FileEntry } from '../sync/types';
import { WebDavClient, requireStatus } from './client';
import { parseListing } from './listing';
import {
  HTTP_STATUS,
  MAX_FOLDERS_PER_SYNC,
  PROPFIND_CHILDREN_DEPTH,
  PROPFIND_PROPERTIES,
} from './protocol';

export class WebDavFolders {
  private readonly known = new Set<string>();
  private readonly pending = new Map<string, Promise<void>>();

  constructor(
    private readonly client: WebDavClient,
    private readonly root: string,
    private readonly include: (path: string) => boolean,
  ) {}

  has(path: string): boolean {
    return this.known.has(path);
  }

  async ensure(path: string): Promise<void> {
    let current = '';

    for (const part of path.split('/')) {
      current = current ? `${current}/${part}` : part;
      if (this.known.has(current)) continue;

      let creating = this.pending.get(current);
      if (!creating) {
        creating = this.createFolder(current);
        this.pending.set(current, creating);
      }
      try {
        await creating;
      } finally {
        if (this.pending.get(current) === creating) this.pending.delete(current);
      }
    }
  }

  private async createFolder(path: string): Promise<void> {
    const response = await this.client.request('MKCOL', path);
    requireStatus(response, [HTTP_STATUS.CREATED, HTTP_STATUS.METHOD_NOT_ALLOWED]);
    this.known.add(path);
  }

  async listFiles(requireRoot = false): Promise<FileEntry[]> {
    const queue = [''];
    const visited = new Set<string>();
    const files: FileEntry[] = [];

    while (queue.length > 0) {
      const relative = queue.shift();
      if (relative === undefined || visited.has(relative)) continue;
      visited.add(relative);
      if (visited.size > MAX_FOLDERS_PER_SYNC)
        throw new Error(t('Too many folders for one sync run.'));

      const folder = `${this.root}${relative ? `/${relative}` : ''}`;
      const response = await this.client.request(
        'PROPFIND',
        folder,
        { Depth: PROPFIND_CHILDREN_DEPTH, 'Content-Type': 'application/xml; charset=utf-8' },
        PROPFIND_PROPERTIES,
      );
      if (response.status === HTTP_STATUS.NOT_FOUND && relative === '') {
        if (requireRoot)
          throw new Error(t('The source folder does not exist. Mirror sync is blocked.'));
        return [];
      }
      requireStatus(response, [HTTP_STATUS.MULTI_STATUS]);
      const entries = parseListing(response.text, this.root);
      if (!entries.some((entry) => entry.path === relative && entry.directory)) {
        throw new Error(t('WebDAV did not confirm the selected folder.'));
      }

      this.known.add(folder);
      for (const entry of entries) {
        if (entry.path === relative) continue;
        if (parentPath(entry.path) !== relative)
          throw new Error(t('WebDAV returned an invalid folder hierarchy.'));
        if (!this.include(entry.path)) continue;
        if (!entry.directory) {
          files.push({
            path: entry.path,
            size: entry.size,
            ...(entry.revision ? { revision: entry.revision } : {}),
          });
          continue;
        }
        this.known.add(`${this.root}/${entry.path}`);
        queue.push(entry.path);
      }
    }
    return files;
  }
}
