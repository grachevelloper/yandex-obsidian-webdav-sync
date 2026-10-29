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

      const response = await this.client.request('MKCOL', current);
      requireStatus(response, [HTTP_STATUS.CREATED, HTTP_STATUS.METHOD_NOT_ALLOWED]);
      this.known.add(current);
    }
  }

  async listFiles(): Promise<FileEntry[]> {
    await this.ensure(this.root);
    const queue = [''];
    const visited = new Set<string>();
    const files: FileEntry[] = [];

    while (queue.length > 0) {
      const relative = queue.shift();
      if (relative === undefined || visited.has(relative)) continue;
      visited.add(relative);
      if (visited.size > MAX_FOLDERS_PER_SYNC)
        throw new Error('Too many folders for one sync run.');

      const folder = `${this.root}${relative ? `/${relative}` : ''}`;
      const response = await this.client.request(
        'PROPFIND',
        folder,
        { Depth: PROPFIND_CHILDREN_DEPTH, 'Content-Type': 'application/xml; charset=utf-8' },
        PROPFIND_PROPERTIES,
      );
      requireStatus(response, [HTTP_STATUS.MULTI_STATUS]);
      const entries = parseListing(response.text, this.root);
      if (!entries.some((entry) => entry.path === relative && entry.directory)) {
        throw new Error('WebDAV did not confirm the selected folder.');
      }

      for (const entry of entries) {
        if (entry.path === relative) continue;
        if (parentPath(entry.path) !== relative)
          throw new Error('WebDAV returned an invalid folder hierarchy.');
        if (!this.include(entry.path)) continue;
        if (!entry.directory) {
          files.push({ path: entry.path, size: entry.size });
          continue;
        }
        this.known.add(`${this.root}/${entry.path}`);
        queue.push(entry.path);
      }
    }
    return files;
  }
}
