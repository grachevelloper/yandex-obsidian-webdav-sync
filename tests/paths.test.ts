import assert from 'node:assert/strict';
import { test } from 'node:test';
import { conflictPath, isIncluded, validatePath, validateRemoteFolder } from '../src/shared/paths';

test('rejects traversal and ambiguous paths', () => {
  for (const path of ['../a', '/a', 'a//b', 'a/./b', 'a/../b', 'a\\b', 'a\0b']) {
    assert.throws(() => validatePath(path));
  }
  assert.equal(validatePath('Заметки/hello # %.md'), 'Заметки/hello # %.md');
});

test('excludes hidden directories and a custom Obsidian configuration directory', () => {
  for (const path of [
    '.obsidian/data.json',
    '.trash/a.md',
    '.git/config',
    'custom-config/a.json',
  ]) {
    assert.equal(isIncluded(path, 'custom-config'), false);
  }
  assert.equal(isIncluded('attachments/photo.png', 'custom-config'), true);
});

test('normalizes a dedicated remote folder but refuses the disk root', () => {
  assert.equal(validateRemoteFolder(' /Obsidian/Personal/ '), 'Obsidian/Personal');
  assert.throws(() => validateRemoteFolder('/'));
});

test('conflict names preserve extensions and fit long Unicode file names', () => {
  const path = conflictPath(`notes/${'я'.repeat(120)}.png`, 'a'.repeat(64));
  assert.ok(path.startsWith('notes/'));
  assert.ok(path.endsWith('.png'));
  assert.ok(new TextEncoder().encode(path.split('/').at(-1)).length <= 255);
});
