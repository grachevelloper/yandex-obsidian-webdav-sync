const MAX_DIFF_CELLS = 1_000_000;
export const MAX_EDITABLE_BYTES = 1024 * 1024;

export function isTextPath(path: string): boolean {
  return /\.(md|txt|csv|json|canvas|yaml|yml|xml|html|css|js|ts)$/iu.test(path);
}

export function editableText(path: string, data: ArrayBuffer): string | undefined {
  if (!isTextPath(path) || data.byteLength > MAX_EDITABLE_BYTES) return undefined;
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data);
  } catch {
    return undefined;
  }
}

export function useBothVersions(localText: string, remoteText: string): string {
  if (localText === remoteText) return localText;
  const local = localText === '' ? [] : localText.split('\n');
  const remote = remoteText === '' ? [] : remoteText.split('\n');
  let prefix = 0;
  while (prefix < local.length && prefix < remote.length && local[prefix] === remote[prefix])
    prefix++;
  let suffix = 0;
  while (
    suffix < local.length - prefix &&
    suffix < remote.length - prefix &&
    local[local.length - 1 - suffix] === remote[remote.length - 1 - suffix]
  )
    suffix++;

  const left = local.slice(prefix, local.length - suffix);
  const right = remote.slice(prefix, remote.length - suffix);
  let middle: string[] = [];
  if (!left.length || !right.length || (left.length + 1) * (right.length + 1) > MAX_DIFF_CELLS) {
    middle = left.concat(right);
  } else {
    const lengths = Array.from(
      { length: left.length + 1 },
      () => new Uint32Array(right.length + 1),
    );
    const lengthAt = (a: number, b: number) => lengths[a]?.[b] ?? 0;
    for (const [a, row] of [...lengths.entries()].reverse()) {
      if (a === left.length) continue;
      for (let b = right.length - 1; b >= 0; b--) {
        row[b] =
          left[a] === right[b]
            ? lengthAt(a + 1, b + 1) + 1
            : Math.max(lengthAt(a + 1, b), lengthAt(a, b + 1));
      }
    }
    let a = 0;
    let b = 0;
    while (a < left.length || b < right.length) {
      const localLine = left[a];
      const remoteLine = right[b];
      if (localLine !== undefined && remoteLine !== undefined && localLine === remoteLine) {
        middle.push(localLine);
        a++;
        b++;
      } else if (
        localLine !== undefined &&
        (remoteLine === undefined || lengthAt(a + 1, b) >= lengthAt(a, b + 1))
      ) {
        middle.push(localLine);
        a++;
      } else if (remoteLine !== undefined) {
        middle.push(remoteLine);
        b++;
      } else break;
    }
  }

  return [...local.slice(0, prefix), ...middle, ...local.slice(local.length - suffix)].join('\n');
}
