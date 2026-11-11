import type { HttpClient } from '../../../src/webdav/client';

let heldRequest: { method: string; ready: Promise<void>; release: () => void } | undefined;

export function holdRequest(method: string) {
  let release = () => {};
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  heldRequest = { method, ready, release };
}

export function releaseRequest() {
  heldRequest?.release();
  heldRequest = undefined;
}

export const obsidianHttp: HttpClient = async (request) => {
  if (heldRequest?.method === request.method) await heldRequest.ready;

  const path = new URL(request.url).pathname;
  const response = { headers: {}, text: '', arrayBuffer: new ArrayBuffer(0) };
  if (request.headers.Authorization !== `Basic ${btoa('fixture:fixture-password')}`)
    return { ...response, status: 401 };

  if (request.method === 'PROPFIND' && (path === '/' || path === '/Fixture')) {
    return {
      ...response,
      status: 207,
      text: `<d:multistatus xmlns:d="DAV:"><d:response><d:href>${path}</d:href>
        <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>
        <d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`,
    };
  }

  if (path === '/Fixture/Start.md') {
    if (request.method === 'GET') return { ...response, status: 404 };
    if (request.method === 'PUT' && request.headers['If-None-Match'] === '*')
      return { ...response, status: 201, headers: { etag: '"fixture-1"' } };
  }

  if (request.method === 'PROPFIND') return { ...response, status: 404 };
  throw new Error(`Unexpected fixture request: ${request.method} ${path}`);
};
