# Yandex WebDAV ETag verification

Verified on 2026-11-02 against `https://webdav.yandex.ru` using one uniquely named hidden temporary file. Only this probe file was created, replaced and deleted. Two different payloads of the same byte count were used; normal vault files were not modified.

| Check                                                | Observed result                                |
| ---------------------------------------------------- | ---------------------------------------------- |
| GET ETag format                                      | Unquoted 32-hex string                         |
| PROPFIND getetag versus GET                          | Identical for the tested version               |
| Replacing content with the same byte count           | ETag changed                                   |
| PUT with the current ETag in quotes                  | 201; subsequent GET returned the new bytes     |
| PUT with an unrelated quoted If-Match                | 412                                            |
| PUT with the previous ETag, quoted and unquoted      | 412; current bytes remained unchanged          |
| PUT with If-None-Match `*` against the existing file | 412                                            |
| ETag returned by successful PUT                      | Absent                                         |
| GET with raw matching If-None-Match                  | 304, no body                                   |
| GET with quoted matching If-None-Match               | 200 with body                                  |
| Cleanup                                              | DELETE 204; follow-up HEAD checks returned 404 |

The implementation accepts the observed bare format and normalizes it to the quoted form used for conditional writes and cache comparisons. It does not infer an ETag from SHA-256 or assume that a successful PUT returns one. It does not use conditional GETs for cache hits; it compares metadata from a complete folder listing with a previously verified GET version.

These checks establish the observed behavior for the tested server and file. Runtime fallback remains necessary for missing or unsupported tags and responses from other files.
