import assert from 'node:assert/strict';
import { test } from 'node:test';
import { russian } from '../../src/i18n/ru';
import { setLanguage, t } from '../../src/i18n';
import { loadPluginData, scopeFor } from '../../src/settings/data';
import { validatePath } from '../../src/shared/paths';

test('language settings migrate, persist and do not change the sync account scope', () => {
  const data = loadPluginData(null);
  assert.equal(data.settings.language, 'ru');
  const english = loadPluginData({ settings: { language: 'en' } });
  assert.equal(english.settings.language, 'en');
  assert.equal(loadPluginData({ settings: { language: 'invalid' } }).settings.language, 'ru');
  assert.equal(scopeFor(data.settings), scopeFor({ ...data.settings, language: 'en' }));
});

test('Russian translates labels, placeholders and backend errors without changing path values', () => {
  setLanguage('ru');
  try {
    assert.equal(t('Start sync'), 'Начать синхронизацию');
    assert.match(t('Unsafe path: {0}', { 0: '../A{0}.md' }), /\.\.\/A\{0\}\.md/);
    assert.throws(() => validatePath('../note.md'), /Недопустимый путь/);
  } finally {
    setLanguage('en');
  }
});

test('English and automatic language selection retain predictable fallbacks', () => {
  setLanguage('auto', 'ru-RU');
  assert.equal(t('Start sync'), 'Начать синхронизацию');
  setLanguage('auto', 'de');
  assert.equal(t('Start sync'), 'Start sync');
  setLanguage('en');
});

test('all translations preserve their interpolation placeholders', () => {
  const placeholders = (text: string) =>
    [...text.matchAll(/\{(\d+)\}/gu)].map((match) => match[1]).sort();
  for (const [english, russianText] of Object.entries(russian)) {
    assert.ok(russianText.trim().length > 0, english);
    assert.deepEqual(placeholders(russianText), placeholders(english), english);
  }
});
