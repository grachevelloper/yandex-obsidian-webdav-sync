import assert from 'node:assert/strict';
import { test } from 'node:test';
import { editableText, useBothVersions } from '../../src/sync/conflict-text';

const bytes = (text: string) => new TextEncoder().encode(text).buffer;

test('Use both preserves both changed values and common lines exactly once', () => {
  assert.equal(
    useBothVersions('# Trip\n\n09:00\n€150\n\nLocal task', '# Trip\n\n10:00\n€200\n\nCloud task'),
    '# Trip\n\n09:00\n€150\n10:00\n€200\n\nLocal task\nCloud task',
  );
});

test('Use both preserves identical whitespace, repeated lines, empty inputs and trailing newlines', () => {
  for (const text of ['', 'A', 'A\nA\n', '# Title\n\n  text  \n'])
    assert.equal(useBothVersions(text, text), text);
  assert.equal(useBothVersions('A\nA\nB', 'A\nB'), 'A\nA\nB');
  assert.equal(useBothVersions('', 'Cloud\n'), 'Cloud\n');
});

test('large differences use bounded memory and retain both original blocks', () => {
  const local = Array.from({ length: 2000 }, (_, index) => 'local ' + index).join('\n');
  const remote = Array.from({ length: 2000 }, (_, index) => 'remote ' + index).join('\n');
  assert.equal(useBothVersions(local, remote), local + '\n' + remote);
});

test('attachments, invalid UTF-8 and oversized text are offered as version choices', () => {
  assert.equal(editableText('photo.png', bytes('text')), undefined);
  assert.equal(editableText('bad.md', new Uint8Array([255]).buffer), undefined);
  assert.equal(editableText('huge.md', new ArrayBuffer(1024 * 1024 + 1)), undefined);
  assert.equal(editableText('note.md', bytes('Заметка')), 'Заметка');
});
