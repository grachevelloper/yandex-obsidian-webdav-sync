import type { LogSink } from '../logging/log';
import { validatePath } from '../shared/paths';
import { HTTP_STATUS, WEBDAV_ENDPOINT } from './protocol';

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

export interface Connection {
  login: string;
  password: string;
  folder: string;
}

export class WebDavClient {
  private readonly authorization: string;

  constructor(
    connection: Connection,
    private readonly http: HttpClient,
    private readonly log: LogSink = () => {},
  ) {
    const credentials = new TextEncoder().encode(`${connection.login}:${connection.password}`);
    this.authorization = `Basic ${btoa(Array.from(credentials, (byte) => String.fromCharCode(byte)).join(''))}`;
  }

  async request(
    method: string,
    path: string,
    headers: Record<string, string> = {},
    body?: string | ArrayBuffer,
  ): Promise<HttpResponse> {
    validatePath(path);
    let response: HttpResponse;

    try {
      response = await this.http({
        method,
        url: `${WEBDAV_ENDPOINT}/${path.split('/').map(encodeURIComponent).join('/')}`,
        headers: { Authorization: this.authorization, ...headers },
        body,
      });
    } catch {
      this.log('error', 'WebDAV network request failed', { method, path });
      throw new Error(
        `WebDAV network error (${method}). Check your connection and run sync again.`,
      );
    }

    const expectedMissingFile = method === 'GET' && response.status === HTTP_STATUS.NOT_FOUND;
    const expectedExistingFolder =
      method === 'MKCOL' && response.status === HTTP_STATUS.METHOD_NOT_ALLOWED;
    const failed =
      response.status >= HTTP_STATUS.BAD_REQUEST && !expectedMissingFile && !expectedExistingFolder;
    this.log(failed ? 'error' : 'info', 'WebDAV response', {
      method,
      path,
      status: response.status,
    });
    return response;
  }
}

export function requireStatus(response: HttpResponse, accepted: readonly number[]): void {
  if (accepted.includes(response.status)) return;
  const authenticationFailed =
    response.status === HTTP_STATUS.UNAUTHORIZED || response.status === HTTP_STATUS.FORBIDDEN;
  throw new Error(
    `WebDAV: HTTP ${response.status}. ${authenticationFailed ? 'Check your login, app password and WebDAV access.' : 'Resolve the server error and run sync again.'}`,
  );
}
