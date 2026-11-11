import { t } from '../i18n';
import type { LogSink } from '../logging/log';
import { preserveVersion } from './recovery';
import { snapshot } from './snapshot';
import type { FileDecision, Snapshot, SyncResult, SyncStore } from './types';

export async function applyResolution(
  local: SyncStore,
  remote: SyncStore,
  path: string,
  resolution: Exclude<FileDecision, { kind: 'skip' | 'delete' }>,
  here: Snapshot | undefined,
  there: Snapshot | undefined,
  result: SyncResult,
  checkActive: () => void,
  log: LogSink,
): Promise<Snapshot> {
  const desired = await resolvedFile(resolution, here, there);
  const { data } = desired;

  for (const [side, version] of [
    ['local', here],
    ['remote', there],
  ] as const) {
    if (!version) continue;
    await preserveVersion(local, version);
    log('info', t('Saved original file in local recovery'), {
      path,
      side,
      recoveryHash: version.hash,
    });
  }
  checkActive();

  if (there?.hash !== desired.hash) {
    await remote.write(path, data, there);
    result.uploaded++;
  }
  checkActive();
  if (here?.hash !== desired.hash) {
    await local.write(path, data, here);
    result.downloaded++;
  }

  log('info', t('Applied reviewed file version to both sides'), { path });
  return desired;
}

export async function resolvedFile(
  resolution: Exclude<FileDecision, { kind: 'skip' | 'delete' }>,
  here: Snapshot | undefined,
  there: Snapshot | undefined,
): Promise<Snapshot> {
  if (resolution.kind === 'text') return snapshot(new TextEncoder().encode(resolution.text).buffer);

  const file = resolution.kind === 'local' ? here : there;
  if (!file) throw new Error(t('The selected version is missing. Prepare a new preview.'));
  return file;
}
