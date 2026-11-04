import { requestUrl } from 'obsidian';
import type { HttpClient } from './client';

export const obsidianHttp: HttpClient = async (request) => {
  const response = await requestUrl({ ...request, throw: false });
  return {
    status: response.status,
    headers: response.headers,
    text: response.text,
    arrayBuffer: response.arrayBuffer,
  };
};
