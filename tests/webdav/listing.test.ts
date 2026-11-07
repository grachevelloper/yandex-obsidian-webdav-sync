import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseListing } from '../../src/webdav/listing';
import { listing } from './fixtures';

test('parses namespace XML, percent escapes and XML entities without altering names', () => {
  const entries = parseListing(
    listing('/Obsidian/%D0%A2%D0%B5%D1%81%D1%82/a%20%23%25&amp;b.md'),
    'Obsidian/Тест',
  );
  assert.deepEqual(entries, [{ path: 'a #%&b.md', size: 4, directory: false }]);
});

test('rejects unsafe, malformed, out-of-scope and incomplete listings', () => {
  for (const xml of [
    '<broken>',
    listing('/elsewhere/file.md'),
    listing('/Obsidian/Тест/a%2Fb.md'),
    listing('/Obsidian/Тест/file.md', '', 'oops'),
    '<!DOCTYPE x [<!ENTITY a "test">]>' + listing('/Obsidian/Тест/a.md'),
    listing('/Obsidian/Тест/a.md').replace('200 OK', '403 Forbidden'),
  ]) {
    assert.throws(() => parseListing(xml, 'Obsidian/Тест'));
  }
});

test('reads ETags from successful property blocks and tolerates unsupported ETags', () => {
  const tag = 'a'.repeat(32);
  const base = listing('/Obsidian/Тест/a.md');
  const xml = base.replace(
    '</d:response>',
    `<d:propstat><d:prop><d:getetag>${tag}</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
  );
  assert.equal(parseListing(xml, 'Obsidian/Тест')[0]?.revision, `"${tag}"`);
  const missing = xml.replace(
    'HTTP/1.1 200 OK</d:status></d:propstat></d:response>',
    'HTTP/1.1 404 Not Found</d:status></d:propstat></d:response>',
  );
  assert.equal(parseListing(missing, 'Obsidian/Тест')[0]?.revision, undefined);
});

test('conflicting successful ETag properties cannot produce a cache hit', () => {
  const base = listing('/Obsidian/Тест/a.md');
  const properties = ['a'.repeat(32), 'b'.repeat(32)]
    .map(
      (etag) =>
        `<d:propstat><d:prop><d:getetag>${etag}</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>`,
    )
    .join('');
  const xml = base.replace('</d:response>', `${properties}</d:response>`);
  assert.equal(parseListing(xml, 'Obsidian/Тест')[0]?.revision, undefined);
});

test('rejects malformed XML structure before using WebDAV properties', () => {
  const valid = listing('/Obsidian/Тест/a.md');
  const malformedListings = [
    valid + '<extra/>',
    valid.replace('</d:prop>', '</d:propstat>'),
    valid.replace('<d:getcontentlength>', '<d:getcontentlength a="1" a="2">'),
    valid.replace('<d:getcontentlength>', '<unknown:getcontentlength>'),
    valid.replace('</d:getcontentlength>', '</unknown:getcontentlength>'),
  ];
  for (const xml of malformedListings) {
    assert.throws(() => parseListing(xml, 'Obsidian/Тест'), /Invalid XML/);
  }
});

test('rejects declarations and external entities before invoking the browser parser', (context) => {
  const parse = context.mock.method(DOMParser.prototype, 'parseFromString');
  const unsafeListings = [
    '<!DOCTYPE d:multistatus SYSTEM "https://example.invalid/private.dtd">' +
      listing('/Obsidian/a.md'),
    '<!DOCTYPE d:multistatus [<!ENTITY secret SYSTEM "file:///private.txt">]>' +
      listing('/Obsidian/a.md'),
  ];
  for (const xml of unsafeListings) {
    assert.throws(() => parseListing(xml, 'Obsidian'), /Invalid XML/);
  }
  assert.equal(parse.mock.callCount(), 0);
});
