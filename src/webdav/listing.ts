import { isObject } from '../shared/objects';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { validatePath } from '../shared/paths';
import { WEBDAV_ENDPOINT } from './protocol';

interface DavEntry {
  path: string;
  size: number;
  directory: boolean;
}

export function parseListing(xml: string, root: string): DavEntry[] {
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml) || XMLValidator.validate(xml) !== true) {
    throw new Error('Invalid XML in the WebDAV response.');
  }

  const document: unknown = new XMLParser({
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: false,
    isArray: (name) => name === 'response' || name === 'propstat',
  }).parse(xml);

  if (!isObject(document) || !isObject(document.multistatus)) {
    throw new Error('Expected a WebDAV multistatus listing.');
  }

  const responses: unknown = document.multistatus.response;
  if (!Array.isArray(responses)) throw new Error('Empty or incomplete WebDAV response.');

  return responses.map((item: unknown) => {
    if (!isObject(item) || typeof item.href !== 'string' || !Array.isArray(item.propstat)) {
      throw new Error('Incomplete WebDAV file properties.');
    }

    const url = new URL(item.href, WEBDAV_ENDPOINT);
    if (url.origin !== WEBDAV_ENDPOINT || url.search || url.hash) {
      throw new Error('WebDAV returned a URL outside the storage endpoint.');
    }

    const fullPath = url.pathname
      .replace(/^\/|\/$/gu, '')
      .split('/')
      .map((segment) => {
        const decoded = decodeURIComponent(segment);
        if (decoded.includes('/') || decoded.includes('\\'))
          throw new Error('Ambiguous WebDAV path.');
        return decoded;
      })
      .join('/');
    validatePath(fullPath);

    if (fullPath !== root && !fullPath.startsWith(`${root}/`)) {
      throw new Error('WebDAV returned a file outside the selected folder.');
    }

    const successful = item.propstat.find(
      (value: unknown) =>
        isObject(value) &&
        typeof value.status === 'string' &&
        /^HTTP\/\S+ 200(?: |$)/u.test(value.status),
    );
    if (!isObject(successful) || !isObject(successful.prop)) {
      throw new Error('WebDAV did not allow reading file properties.');
    }

    const properties = successful.prop;
    const directory =
      isObject(properties.resourcetype) && Object.hasOwn(properties.resourcetype, 'collection');
    const size = directory ? 0 : Number(properties.getcontentlength);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid WebDAV file size.');

    return { path: fullPath === root ? '' : fullPath.slice(root.length + 1), size, directory };
  });
}
