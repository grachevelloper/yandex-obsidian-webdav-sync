import { t } from '../i18n';

import type { LogSink } from '../logging/log';
import { validatePath } from '../shared/paths';
import { HTTP_STATUS, WEBDAV_ENDPOINT } from './protocol';
import { RequestScheduler, type RequestOptions } from './request-scheduler';
import { NetworkRequestError, networkErrorCode } from './network-error';

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
  private readonly scheduler: RequestScheduler;
  private readonly now: () => number;

  constructor(
    connection: Connection,
    private readonly http: HttpClient,
    private readonly log: LogSink = () => {},
    private readonly options: RequestOptions = {},
  ) {
    this.scheduler = new RequestScheduler(options.timing, options);
    this.now = () => options.timing?.now() ?? Date.now();
    const credentials = new TextEncoder().encode(`${connection.login}:${connection.password}`);
    this.authorization = `Basic ${btoa(Array.from(credentials, (byte) => String.fromCharCode(byte)).join(''))}`;
  }

  async request(
    method: string,
    path: string,
    headers: Record<string, string> = {},
    body?: string | ArrayBuffer,
  ): Promise<HttpResponse> {
    if (path !== '') validatePath(path);

    return this.scheduler.run(
      method,
      () => this.send(method, path, headers, body),
      (retry) => {
        const details: Record<string, string | number> = {
          method,
          path,
          delayMs: retry.delayMs,
          attempt: retry.attempt,
          reason: retry.reason,
        };
        if (retry.code) details.code = retry.code;

        this.log('info', t('WebDAV request; waiting before retry'), details);
        this.options.onRetry?.(retry);
      },
    );
  }

  private async send(
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: string | ArrayBuffer,
  ): Promise<HttpResponse> {
    const startedAt = this.now();
    this.log('info', t('WebDAV request started'), { method, path });
    this.options.onRequest?.(method, path);
    let response: HttpResponse;

    try {
      response = await this.http({
        method,
        url: `${WEBDAV_ENDPOINT}/${path.split('/').map(encodeURIComponent).join('/')}`,
        headers: { Authorization: this.authorization, ...headers },
        body,
      });
    } catch (error) {
      const code = networkErrorCode(error);
      this.log('error', t('WebDAV network request failed'), {
        method,
        path,
        code,
        elapsedMs: this.now() - startedAt,
      });
      throw new NetworkRequestError(method, code);
    }

    const expectedMissingFile = method === 'GET' && response.status === HTTP_STATUS.NOT_FOUND;
    const expectedExistingFolder =
      method === 'MKCOL' && response.status === HTTP_STATUS.METHOD_NOT_ALLOWED;
    const failed =
      response.status >= HTTP_STATUS.BAD_REQUEST && !expectedMissingFile && !expectedExistingFolder;
    this.log(failed ? 'error' : 'info', t('WebDAV response'), {
      method,
      path,
      status: response.status,
      elapsedMs: this.now() - startedAt,
    });
    return response;
  }
}

export function requireStatus(response: HttpResponse, accepted: readonly number[]): void {
  if (accepted.includes(response.status)) return;
  const authenticationFailed =
    response.status === HTTP_STATUS.UNAUTHORIZED || response.status === HTTP_STATUS.FORBIDDEN;
  throw new Error(
    t('WebDAV: HTTP {0}. {1}', {
      '0': response.status,
      '1': authenticationFailed
        ? t('Check your login, app password and WebDAV access.')
        : t('Resolve the server error and run sync again.'),
    }),
  );
}
