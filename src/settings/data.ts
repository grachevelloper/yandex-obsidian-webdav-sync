import { validateRemoteFolder } from '../shared/paths';
import type { SyncState } from '../sync/engine';

export interface Settings {
  login: string;
  password: string;
  folder: string;
}

export interface PluginData {
  settings: Settings;
  state: SyncState;
}

export function scopeFor(settings: Settings): string {
  return JSON.stringify([settings.login.trim(), validateRemoteFolder(settings.folder)]);
}

export function emptyState(scope: string): SyncState {
  return { version: 1, scope, hashes: Object.create(null) };
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function loadPluginData(value: unknown): PluginData {
  if (value !== null && value !== undefined && !object(value))
    throw new Error('Некорректные сохранённые настройки.');
  const settings: Settings = { login: '', password: '', folder: 'Obsidian/Personal' };

  if (object(value) && object(value.settings)) {
    for (const key of ['login', 'password', 'folder'] as const) {
      const setting = value.settings[key];
      if (typeof setting === 'string') settings[key] = setting;
    }
  }

  const state = emptyState('');
  if (object(value) && value.state !== undefined) {
    const saved = value.state;
    if (
      !object(saved) ||
      saved.version !== 1 ||
      typeof saved.scope !== 'string' ||
      !object(saved.hashes)
    ) {
      throw new Error(
        'Не удалось прочитать состояние синхронизации. Сохраните data.json перед восстановлением.',
      );
    }

    state.scope = saved.scope;
    for (const [path, hash] of Object.entries(saved.hashes)) {
      if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/u.test(hash))
        throw new Error('Некорректное состояние синхронизации.');
      state.hashes[path] = hash;
    }
  }

  return { settings, state };
}
