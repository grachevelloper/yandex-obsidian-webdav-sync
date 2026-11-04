import { t } from '../i18n';
import type { FileVersion } from './types';

type SyncChange =
  | { kind: 'missing' }
  | { kind: 'unchanged'; hash: string }
  | { kind: 'upload'; local: FileVersion; remote?: FileVersion }
  | { kind: 'download'; remote: FileVersion; local?: FileVersion }
  | { kind: 'conflict'; local: FileVersion; remote: FileVersion };

export function decideChange(
  local: FileVersion | undefined,
  remote: FileVersion | undefined,
  baseline: string | undefined,
): SyncChange {
  if (!local && !remote) return { kind: 'missing' };
  if (local && local.hash === remote?.hash) return { kind: 'unchanged', hash: local.hash };
  if (local && (!remote || baseline === remote.hash)) return { kind: 'upload', local, remote };
  if (remote && (!local || baseline === local.hash)) return { kind: 'download', remote, local };
  if (local && remote) return { kind: 'conflict', local, remote };
  throw new Error(t('Unexpected synchronization state.'));
}
