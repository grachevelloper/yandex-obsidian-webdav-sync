import { MAX_FILE_BYTES, parentPath, validatePath, validateRemoteFolder } from '../shared/paths';
import {
  ChangedDuringSync,
  snapshot,
  type FileEntry,
  type Snapshot,
  type SyncStore,
} from '../sync/engine';
import { parseListing } from './listing';

export interface HttpRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string | ArrayBuffer;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
  arrayBuffer: ArrayBuffer;
}

export type HttpClient = (request: HttpRequest) => Promise<HttpResponse>;

interface Connection {
  login: string;
  password: string;
  folder: string;
}

const PROPERTIES =
  '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/></d:prop></d:propfind>';

export class WebDavStore implements SyncStore {
  private readonly folder: string;
  private readonly authorization: string;
  private readonly directories = new Set<string>();

  constructor(
    connection: Connection,
    private readonly http: HttpClient,
    private readonly include: (path: string) => boolean,
  ) {
    this.folder = validateRemoteFolder(connection.folder);
    const credentials = new TextEncoder().encode(`${connection.login}:${connection.password}`);
    this.authorization = `Basic ${btoa(Array.from(credentials, (byte) => String.fromCharCode(byte)).join(''))}`;
  }

  async list(): Promise<FileEntry[]> {
    await this.ensureDirectory(this.folder);
    const queue = [''];
    const visited = new Set<string>();
    const files: FileEntry[] = [];

    while (queue.length > 0) {
      const relative = queue.shift();
      if (relative === undefined || visited.has(relative)) continue;
      visited.add(relative);
      if (visited.size > 10000) throw new Error('Слишком много папок для одного запуска.');

      const folder = `${this.folder}${relative ? `/${relative}` : ''}`;
      const response = await this.request(
        'PROPFIND',
        folder,
        { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
        PROPERTIES,
      );
      this.requireStatus(response, [207]);
      const entries = parseListing(response.text, this.folder);
      if (!entries.some((entry) => entry.path === relative && entry.directory)) {
        throw new Error('WebDAV не подтвердил выбранную папку.');
      }

      for (const entry of entries) {
        if (entry.path === relative) continue;
        if (parentPath(entry.path) !== relative)
          throw new Error('WebDAV вернул некорректную вложенность папок.');
        if (!this.include(entry.path)) continue;

        if (entry.directory) {
          this.directories.add(this.fullPath(entry.path));
          queue.push(entry.path);
        } else {
          files.push({ path: entry.path, size: entry.size });
        }
      }
    }

    return files;
  }

  async read(path: string): Promise<Snapshot | undefined> {
    const fullPath = this.fullPath(path);
    if (this.directories.has(fullPath)) throw new Error(`Вместо файла существует папка: ${path}`);
    const response = await this.request('GET', fullPath);
    if (response.status === 404) return undefined;
    this.requireStatus(response, [200]);

    const revision = Object.entries(response.headers).find(
      ([name]) => name.toLowerCase() === 'etag',
    )?.[1];
    return snapshot(response.arrayBuffer, revision);
  }

  async write(path: string, data: ArrayBuffer, expected: Snapshot | undefined): Promise<void> {
    if (data.byteLength > MAX_FILE_BYTES) throw new Error('Файл превышает лимит 50 МиБ.');
    if (expected && (!expected.revision || !/^"[^"\r\n]*"$/u.test(expected.revision))) {
      throw new Error('Сервер не вернул сильный ETag; безопасная перезапись невозможна.');
    }

    const fullPath = this.fullPath(path);
    await this.ensureDirectory(parentPath(fullPath));
    const condition: Record<string, string> = {};
    if (expected?.revision) {
      condition['If-Match'] = expected.revision;
    } else {
      condition['If-None-Match'] = '*';
    }
    const response = await this.request(
      'PUT',
      fullPath,
      { 'Content-Type': 'application/octet-stream', ...condition },
      data,
    );

    if ([409, 412].includes(response.status)) throw new ChangedDuringSync(path);
    this.requireStatus(response, [200, 201, 204]);
  }

  private fullPath(path: string): string {
    validatePath(path);
    if (!this.include(path)) throw new Error('Служебный файл исключён из синхронизации.');
    return `${this.folder}/${path}`;
  }

  private async ensureDirectory(path: string): Promise<void> {
    let current = '';

    for (const part of path.split('/')) {
      current = current ? `${current}/${part}` : part;
      if (this.directories.has(current)) continue;

      const response = await this.request('MKCOL', current);
      this.requireStatus(response, [201, 405]);
      this.directories.add(current);
    }
  }

  private async request(
    method: string,
    path: string,
    headers: Record<string, string> = {},
    body?: string | ArrayBuffer,
  ): Promise<HttpResponse> {
    try {
      return await this.http({
        method,
        url: `https://webdav.yandex.ru/${path.split('/').map(encodeURIComponent).join('/')}`,
        headers: { Authorization: this.authorization, ...headers },
        body,
      });
    } catch {
      throw new Error(
        `Сетевая ошибка WebDAV (${method}). Проверьте подключение и повторите запуск.`,
      );
    }
  }

  private requireStatus(response: HttpResponse, accepted: number[]): void {
    if (!accepted.includes(response.status)) {
      throw new Error(
        `WebDAV: HTTP ${response.status}. ${[401, 403].includes(response.status) ? 'Проверьте логин, пароль приложения и доступ WebDAV.' : 'Повторите запуск после устранения ошибки.'}`,
      );
    }
  }
}
