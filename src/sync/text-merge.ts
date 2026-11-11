import { diff3Merge } from 'node-diff3';
import type { MergeChunk, Snapshot, SyncStore } from './types';
import { editableText } from './conflict-text';
import { ChangedDuringSync } from './errors';

const MAX_MERGE_LINES = 20_000;
const MAX_MATCHING_LINES = 1_000_000;

export async function prepareTextMerge(
  local: SyncStore,
  remote: SyncStore,
  path: string,
  baseline: string,
  here: Snapshot,
  remoteHash: string,
): Promise<MergeChunk[] | undefined> {
  const device = editableText(path, here.data);
  if (device === undefined || !local.readBaseline) return undefined;

  const previous = await local.readBaseline(path).catch(() => undefined);
  if (previous?.hash !== baseline) return undefined;
  const base = editableText(path, previous.data);
  if (base === undefined) return undefined;

  const there = await remote.read(path);
  if (there?.hash !== remoteHash) throw new ChangedDuringSync(path);
  const disk = editableText(path, there.data);
  if (disk === undefined) return undefined;

  const baseLines = lines(base);
  const deviceLines = lines(device);
  const diskLines = lines(disk);
  if (!baseLines || !deviceLines || !diskLines || !canCompare(baseLines, deviceLines, diskLines))
    return undefined;

  return diff3Merge(deviceLines, baseLines, diskLines, { excludeFalseConflicts: true }).flatMap(
    ({ ok, conflict }): MergeChunk[] => {
      if (ok) return [{ text: ok.join('') }];
      if (conflict)
        return [
          {
            local: conflict.a.join(''),
            remote: conflict.b.join(''),
            base: conflict.o.join(''),
          },
        ];
      return [];
    },
  );
}

export function mergedText(chunks: MergeChunk[] | undefined): string | undefined {
  if (chunks?.every((chunk) => 'text' in chunk)) return chunks.map(({ text }) => text).join('');
  return undefined;
}

function lines(text: string): string[] | undefined {
  const result: string[] = [];
  for (const match of text.matchAll(/[^\n]*\n|[^\n]+$/gu)) {
    if (result.length === MAX_MERGE_LINES) return undefined;
    result.push(match[0]);
  }
  return result;
}

function canCompare(base: string[], device: string[], disk: string[]): boolean {
  const occurrences = new Map<string, number>();
  for (const line of base) occurrences.set(line, (occurrences.get(line) ?? 0) + 1);

  // The diff engine compares matching occurrences. Repeated lines can make this expensive.
  let matches = 0;
  for (const version of [device, disk]) {
    for (const line of version) {
      matches += occurrences.get(line) ?? 0;
      if (matches > MAX_MATCHING_LINES) return false;
    }
  }
  return true;
}
