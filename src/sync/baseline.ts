import { t } from '../i18n';
import type { LogSink } from '../logging/log';
import { editableText, isTextPath } from './conflict-text';
import type { Snapshot, SyncState, SyncStore } from './types';

export async function rememberBaseline(
  local: SyncStore,
  state: SyncState,
  path: string,
  file: Snapshot,
  log: LogSink,
): Promise<void> {
  await saveText(local, path, file, log);
  state.hashes[path] = file.hash;
}

export async function rememberUnchanged(
  local: SyncStore,
  state: SyncState,
  path: string,
  hash: string,
  log: LogSink,
): Promise<void> {
  if (local.readBaseline && local.saveBaseline && isTextPath(path)) {
    try {
      const cached = await local.readBaseline(path);
      if (cached?.hash !== hash) {
        const file = await local.read(path);
        if (file?.hash === hash) await saveText(local, path, file, log);
      }
    } catch {
      log('info', t('Could not keep the common text for future merges.'), { path });
    }
  }
  state.hashes[path] = hash;
}

export async function forgetBaseline(
  local: SyncStore,
  state: SyncState,
  path: string,
  log: LogSink,
): Promise<void> {
  delete state.hashes[path];
  try {
    await local.forgetBaseline?.(path);
  } catch {
    log('info', t('Could not remove the previous common text.'), { path });
  }
}

async function saveText(
  local: SyncStore,
  path: string,
  file: Snapshot,
  log: LogSink,
): Promise<void> {
  if (!local.saveBaseline || !isTextPath(path)) return;
  try {
    if (editableText(path, file.data) !== undefined) await local.saveBaseline(path, file);
    else await local.forgetBaseline?.(path);
  } catch {
    log('info', t('Could not keep the common text for future merges.'), { path });
  }
}
