import { t, isLanguagePreference, type LanguagePreference } from '../i18n';

import {
  DEFAULT_TRANSFER_LIMITS,
  isConcurrentRequests,
  isRequestIntervalMs,
  validateTransferLimits,
  type TransferLimits,
} from '../shared/transfer-limits';
import { emptyRemoteCache, loadRemoteCache, type RemoteCache } from '../sync/remote-cache';
import { isObject } from '../shared/objects';
import { validateRemoteFolder } from '../shared/paths';
import type { SyncState } from '../sync/types';

export interface Settings extends TransferLimits {
  language: LanguagePreference;
  login: string;
  password: string;
  folder: string;
}

export interface PluginData {
  settings: Settings;
  state: SyncState;
  remoteCache: RemoteCache;
}

export function scopeFor(settings: Settings): string {
  return JSON.stringify([settings.login.trim(), validateRemoteFolder(settings.folder)]);
}

export function emptyState(scope: string): SyncState {
  const hashes: Record<string, string> = {};
  Object.setPrototypeOf(hashes, null);
  return { version: 1, scope, hashes };
}

export function loadPluginData(value: unknown): PluginData {
  if (value !== null && value !== undefined && !isObject(value))
    throw new Error(t('Invalid saved settings.'));

  const settings: Settings = {
    language: 'ru',
    login: '',
    password: '',
    folder: 'Obsidian/Personal',
    ...DEFAULT_TRANSFER_LIMITS,
  };

  if (isObject(value) && isObject(value.settings)) {
    for (const key of ['login', 'password', 'folder'] as const) {
      const setting = value.settings[key];
      if (typeof setting === 'string') settings[key] = setting;
    }

    if (isLanguagePreference(value.settings.language)) settings.language = value.settings.language;

    if (isConcurrentRequests(value.settings.concurrentRequests))
      settings.concurrentRequests = value.settings.concurrentRequests;
    if (isRequestIntervalMs(value.settings.requestIntervalMs))
      settings.requestIntervalMs = value.settings.requestIntervalMs;
  }

  const state = emptyState('');
  if (isObject(value) && value.state !== undefined) {
    const saved = value.state;
    if (
      !isObject(saved) ||
      saved.version !== 1 ||
      typeof saved.scope !== 'string' ||
      !isObject(saved.hashes)
    ) {
      throw new Error(t('Cannot read sync state. Preserve data.json before recovery.'));
    }

    state.scope = saved.scope;
    for (const [path, hash] of Object.entries(saved.hashes)) {
      if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/u.test(hash))
        throw new Error(t('Invalid sync state.'));
      state.hashes[path] = hash;
    }
  }

  const remoteCache = isObject(value) ? loadRemoteCache(value.remoteCache) : emptyRemoteCache('');
  return { settings, state, remoteCache };
}

export function validateSettings(settings: Settings): Settings {
  const login = settings.login.trim();
  if (!login || !settings.password || login.includes(':')) {
    throw new Error(t('Enter your Yandex login and app password in the plugin settings.'));
  }
  validateTransferLimits(settings);
  return { ...settings, login, folder: validateRemoteFolder(settings.folder) };
}
