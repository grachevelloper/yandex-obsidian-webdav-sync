import assert from 'node:assert/strict';
import { WebDavStore } from '../../src/webdav/store';
import type { HttpRequest, HttpResponse } from '../../src/webdav/client';

export function response(
  status: number,
  text = '',
  headers: Record<string, string> = {},
): HttpResponse {
  return { status, text, headers, arrayBuffer: new TextEncoder().encode(text).buffer };
}

export function client(replies: HttpResponse[]) {
  const requests: HttpRequest[] = [];
  const store = new WebDavStore(
    { login: 'user', password: 'secret', folder: 'Obsidian/Тест' },
    async (request) => {
      requests.push(request);
      const reply = replies.shift();
      assert.ok(reply, `Unexpected ${request.method}`);
      return reply;
    },
    () => true,
  );
  return { store, requests };
}

export const listing = (href: string, type = '', size = '4') => `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:"><d:response><d:href>${href}</d:href>
<d:propstat><d:prop><d:resourcetype>${type}</d:resourcetype><d:getcontentlength>${size}</d:getcontentlength></d:prop>
<d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;
