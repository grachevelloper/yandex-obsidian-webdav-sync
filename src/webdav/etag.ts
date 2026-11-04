const QUOTED_ETAG = /^"[\x21\x23-\x7e\x80-\xff]*"$/u;
const YANDEX_ETAG = /^[a-fA-F0-9]{32}$/u;

export function normalizeETag(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const tag = value.trim();
  if (QUOTED_ETAG.test(tag)) return tag;
  // Yandex returns bare tags, but accepts the quoted form for conditional writes.
  if (YANDEX_ETAG.test(tag)) return `"${tag}"`;
  return undefined;
}
