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
