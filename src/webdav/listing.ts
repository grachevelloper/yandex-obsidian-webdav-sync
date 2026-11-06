import { t } from '../i18n';
import { normalizeETag } from './etag';
import { isObject } from '../shared/objects';
import { XMLParser } from 'fast-xml-parser';
import { SyntaxValidator } from 'fast-xml-validator';
import { validatePath } from '../shared/paths';
import { WEBDAV_ENDPOINT } from './protocol';

interface DavEntry {
  path: string;
  size: number;
  directory: boolean;
  revision?: string;
}

export function parseListing(xml: string, root: string): DavEntry[] {
  try {
    if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) throw new Error();
    SyntaxValidator.validate(xml);
  } catch {
    throw new Error(t('Invalid XML in the WebDAV response.'));
  }

  const document: unknown = new XMLParser({
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: false,
    isArray: (name) => name === 'response' || name === 'propstat',
  }).parse(xml);

  if (!isObject(document) || !isObject(document.multistatus)) {
    throw new Error(t('Expected a WebDAV multistatus listing.'));
  }

  const responses: unknown = document.multistatus.response;
  if (!Array.isArray(responses)) throw new Error(t('Empty or incomplete WebDAV response.'));

  return responses.map((item: unknown) => {
    if (!isObject(item) || typeof item.href !== 'string' || !Array.isArray(item.propstat)) {
      throw new Error(t('Incomplete WebDAV file properties.'));
    }

    const url = new URL(item.href, WEBDAV_ENDPOINT);
    if (url.origin !== WEBDAV_ENDPOINT || url.search || url.hash) {
      throw new Error(t('WebDAV returned a URL outside the storage endpoint.'));
    }

    const fullPath = url.pathname
      .replace(/^\/|\/$/gu, '')
      .split('/')
      .map((segment) => {
        const decoded = decodeURIComponent(segment);
        if (decoded.includes('/') || decoded.includes('\\'))
          throw new Error(t('Ambiguous WebDAV path.'));
        return decoded;
      })
      .join('/');
    if (fullPath !== '' || root !== '') validatePath(fullPath);

    if (fullPath !== root && !fullPath.startsWith(`${root}/`)) {
      throw new Error(t('WebDAV returned a file outside the selected folder.'));
    }

    const properties = successfulProperties(item.propstat);
    const revision = normalizeETag(properties.getetag);
    const directory =
      isObject(properties.resourcetype) && Object.hasOwn(properties.resourcetype, 'collection');
    const size = directory ? 0 : Number(properties.getcontentlength);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(t('Invalid WebDAV file size.'));

    return {
      path: fullPath === root ? '' : fullPath.slice(root.length + 1),
      size,
      directory,
      ...(revision ? { revision } : {}),
    };
  });
}

function successfulProperties(values: unknown[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  Object.setPrototypeOf(properties, null);
  let found = false;
  let etagSeen = false;
  let ambiguousEtag = false;
  for (const value of values) {
    if (
      !isObject(value) ||
      typeof value.status !== 'string' ||
      !/^HTTP\/\S+ 200(?: |$)/u.test(value.status) ||
      !isObject(value.prop)
    )
      continue;
    found = true;
    if (Object.hasOwn(value.prop, 'getetag')) {
      if (etagSeen && value.prop.getetag !== properties.getetag) ambiguousEtag = true;
      etagSeen = true;
    }
    Object.assign(properties, value.prop);
  }
  if (!found) throw new Error(t('WebDAV did not allow reading file properties.'));
  if (ambiguousEtag) properties.getetag = undefined;
  return properties;
}
