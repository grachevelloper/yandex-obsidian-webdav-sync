import { defineConfig, globalIgnores } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig([
  globalIgnores([
    'node_modules/**',
    'main.js',
    'release/**',
    '.artifacts/**',
    'tests/**',
    'scripts/**',
    'esbuild.config.mjs',
    'eslint*.config.mjs',
  ]),
  ...obsidianmd.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: true },
    },
  },
]);
