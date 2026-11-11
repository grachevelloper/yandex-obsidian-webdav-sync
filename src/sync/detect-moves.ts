import { t } from '../i18n';
import type { PlanEntry } from './types';

export function detectMoves(entries: PlanEntry[]): PlanEntry[] {
  const missing = new Map<string, PlanEntry[]>();
  const added = new Map<string, PlanEntry[]>();

  for (const entry of entries) {
    if (!['upload', 'download', 'unchanged'].includes(entry.action)) continue;
    const { baseline, localHash, remoteHash } = entry;
    const hash = localHash ?? remoteHash;
    if (!hash) continue;

    const group =
      baseline === hash && (!localHash || !remoteHash)
        ? missing
        : !baseline && (!localHash || !remoteHash || localHash === remoteHash)
          ? added
          : undefined;
    if (!group) continue;
    const matches = group.get(hash) ?? [];
    matches.push(entry);
    group.set(hash, matches);
  }

  const consumed = new Set<PlanEntry>();
  for (const [hash, sources] of missing) {
    const targets = added.get(hash);
    const source = sources[0];
    const target = targets?.[0];
    if (!source || !target) continue;
    if (sources.length !== 1 || targets.length !== 1) {
      for (const entry of sources)
        entry.message = t(
          'Several files match this possible move. Check their paths before confirming.',
        );
      continue;
    }
    if (!(source.localHash ? target.remoteHash : target.localHash)) continue;

    source.action = 'move';
    source.move = {
      targetPath: target.path,
      localHash: target.localHash,
      remoteHash: target.remoteHash,
    };
    consumed.add(target);
  }
  return entries.filter((entry) => !consumed.has(entry));
}
