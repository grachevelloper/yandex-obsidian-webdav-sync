import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { validatePath } from '../shared/paths';

interface DavEntry {
  path: string;
  size: number;
  directory: boolean;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseListing(xml: string, root: string): DavEntry[] {
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml) || XMLValidator.validate(xml) !== true) {
    throw new Error('Некорректный XML в ответе WebDAV.');
  }

  const document: unknown = new XMLParser({
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: false,
    isArray: (name) => name === 'response' || name === 'propstat',
  }).parse(xml);

  if (!object(document) || !object(document.multistatus)) {
    throw new Error('Ожидался список WebDAV multistatus.');
  }

  const responses: unknown = document.multistatus.response;
  if (!Array.isArray(responses)) throw new Error('Пустой или неполный ответ WebDAV.');

  return responses.map((item: unknown) => {
    if (!object(item) || typeof item.href !== 'string' || !Array.isArray(item.propstat)) {
      throw new Error('Неполное описание файла WebDAV.');
    }

    const url = new URL(item.href, 'https://webdav.yandex.ru');
    if (url.origin !== 'https://webdav.yandex.ru' || url.search || url.hash) {
      throw new Error('WebDAV вернул ссылку за пределами хранилища.');
    }

    const fullPath = url.pathname
      .replace(/^\/|\/$/gu, '')
      .split('/')
      .map((segment) => {
        const decoded = decodeURIComponent(segment);
        if (decoded.includes('/') || decoded.includes('\\'))
          throw new Error('Неоднозначный путь WebDAV.');
        return decoded;
      })
      .join('/');
    validatePath(fullPath);

    if (fullPath !== root && !fullPath.startsWith(`${root}/`)) {
      throw new Error('WebDAV вернул файл вне выбранной папки.');
    }

    const successful = item.propstat.find(
      (value: unknown) =>
        object(value) &&
        typeof value.status === 'string' &&
        /^HTTP\/\S+ 200(?: |$)/u.test(value.status),
    );
    if (!object(successful) || !object(successful.prop)) {
      throw new Error('WebDAV не разрешил прочитать свойства файла.');
    }

    const properties = successful.prop;
    const directory =
      object(properties.resourcetype) && Object.hasOwn(properties.resourcetype, 'collection');
    const size = directory ? 0 : Number(properties.getcontentlength);
    if (!Number.isSafeInteger(size) || size < 0)
      throw new Error('Некорректный размер файла WebDAV.');

    return { path: fullPath === root ? '' : fullPath.slice(root.length + 1), size, directory };
  });
}
