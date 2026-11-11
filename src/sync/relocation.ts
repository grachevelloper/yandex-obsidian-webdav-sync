import { t } from '../i18n';
import type { LogSink } from '../logging/log';
import { parentPath, validateFilePaths, validatePath } from '../shared/paths';
import { resolvedFile } from './apply-resolution';
import { ChangedDuringSync } from './errors';
import { preserveVersion } from './recovery';
import type { FileDecision, PlanEntry, Snapshot, SyncResult, SyncStore } from './types';

export function nameParts(path: string): { stem: string; extension: string } {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0
    ? { stem: name.slice(0, dot), extension: name.slice(dot) }
    : { stem: name, extension: '' };
}

export function renamedPath(path: string, value: string): string {
  const stem = value.trim();
  const name = stem + nameParts(path).extension;
  if (
    !stem ||
    stem.startsWith('.') ||
    stem.endsWith('.') ||
    /[<>:"/\\|?*]/u.test(stem) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name) ||
    new TextEncoder().encode(name).length > 255
  )
    throw new Error(t('Enter a valid file name.'));

  const parent = parentPath(path);
  return validatePath(parent ? `${parent}/${name}` : name);
}

export function relocationTarget(entry: PlanEntry): string | undefined {
  return entry.renameTo ?? entry.move?.targetPath;
}

export function validateRelocations(entries: readonly PlanEntry[]): void {
  const paths = new Set(entries.map(({ path }) => path));
  const existingCount = paths.size;
  for (const entry of entries) {
    if (entry.resolution?.kind === 'skip') continue;
    const target = relocationTarget(entry);
    if (!target) continue;
    if (
      entry.renameTo &&
      (entry.move || target !== renamedPath(entry.path, nameParts(target).stem))
    )
      throw new Error(t('Enter a valid file name.'));
    if (paths.has(target)) throw new Error(t('This name is already in use: {0}', { '0': target }));
    paths.add(target);
  }
  if (paths.size !== existingCount) validateFilePaths(paths);
}

export async function applyRelocation(
  local: SyncStore,
  remote: SyncStore,
  entry: PlanEntry,
  here: Snapshot | undefined,
  there: Snapshot | undefined,
  resolution: Exclude<FileDecision, { kind: 'skip' | 'delete' }> | undefined,
  result: SyncResult,
  checkActive: () => void,
  log: LogSink,
): Promise<Snapshot> {
  const { path, move } = entry;
  const target = relocationTarget(entry);
  if (!target) throw new Error(t('Invalid sync preview. Prepare a new preview.'));

  const [localTarget, remoteTarget] = await Promise.all([local.read(target), remote.read(target)]);
  checkActive();
  if (localTarget?.hash !== move?.localHash || remoteTarget?.hash !== move?.remoteHash)
    throw new ChangedDuringSync(target);

  const file = resolution
    ? await resolvedFile(resolution, here, there)
    : move
      ? (localTarget ?? remoteTarget)
      : entry.action === 'download' || entry.action === 'delete-remote'
        ? there
        : (here ?? there);
  if (!file || (move && file.hash !== entry.baseline))
    throw new Error(t('Invalid sync preview. Prepare a new preview.'));
  if ((here && !local.move && !local.remove) || (there && !remote.remove))
    throw new Error(t('This file cannot be moved safely.'));

  for (const [side, previous] of [
    ['local', here],
    ['remote', there],
  ] as const) {
    if (!previous) continue;
    await preserveVersion(local, previous);
    log('info', t('Saved original file in local recovery'), {
      path,
      side,
      recoveryHash: previous.hash,
    });
  }

  checkActive();
  if (!remoteTarget) {
    await remote.write(target, file.data, undefined);
    result.uploaded++;
  }

  checkActive();
  let movedLocally = false;
  if (!localTarget && here && local.move) {
    await local.move(path, target, here);
    movedLocally = true;
    checkActive();
    if (here.hash !== file.hash) await local.write(target, file.data, here);
  } else if (!localTarget) {
    await local.write(target, file.data, undefined);
    result.downloaded++;
  }

  const [savedLocal, savedRemote] = await Promise.all([local.read(target), remote.read(target)]);
  checkActive();
  if (savedLocal?.hash !== file.hash || savedRemote?.hash !== file.hash)
    throw new ChangedDuringSync(target);

  if (there) await remote.remove?.(path, there);
  if (here && !movedLocally) {
    checkActive();
    await local.remove?.(path, here);
  }
  log('info', t('Saved the file at its new path.'), { path, target });
  return file;
}
