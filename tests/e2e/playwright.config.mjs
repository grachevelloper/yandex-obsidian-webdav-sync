import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
import { devices } from './helpers/obsidian-session.mjs';

export default defineConfig({
  testDir: '.',
  testMatch: 'sync.spec.mjs',
  outputDir: '../../.artifacts/ui-e2e/results',
  projects: devices.map(({ id }) => ({ name: id })),
  workers: 1,
  timeout: 60000,
  reporter: 'list',
  expect: { toHaveScreenshot: { stylePath: join(import.meta.dirname, 'helpers/snapshot.css') } },
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  updateSnapshots: 'none',
  preserveOutput: 'failures-only',
});
