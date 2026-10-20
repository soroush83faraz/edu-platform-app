# files

Generic storage of uploaded files (bytes on disk under `FILES_DIR`, metadata in `files.file_object`) — «پیوست تکلیف و تحویل پاسخ», docs/decisions.md 2026-10-19. The business rules of WHO may upload, attach and download live in the workspace module (`src/modules/workspace/{file-access,work-item-files,submissions,file-gates}.ts`).

- `kinds.ts` — the ONE allowlist of kinds: served Content-Type, accepted extensions, inline (images only). Client-safe.
- `limits.ts` — every number (per file, per set, per پاسخ, daily quota, timeouts, slots) and the Persian messages. Client-safe.
- `sniff.ts` — the kind from the BYTES (magic numbers; OOXML via the ZIP central directory and its small XML parts under one inflate cap — no macros, embedded objects or external relationships; strict UTF-8 text, always served as `.txt`). Default deny.
- `names.ts` — the client's name as display text only; `Content-Disposition`.
- `paths.ts` — `<org>/<yyyy>/<id>` keys from server values, re-validated on every resolve.
- `receive.ts` — the request body streamed to a temp file with the cap and the pace rule (idle, minimum average rate, wall clock), nothing left behind on failure.
- `storage.ts` — `FILES_DIR` (lazy), publish by rename, best-effort removal, free space, temp sweep, upload slots and attempt window.
- `serve.ts` — the response headers of a served file (untrusted content; next.config.ts carries the same set for `/files/:path*`).
- `sweep.ts` — the bounded orphan sweep (bytes no live row names, older than a day; `app.live_file_ids`), run after uploads and by `scripts/sweep-files.ts`.
- `upload-request.ts` — the same-origin lock and the three inputs of `POST /api/files`.
- `ui/` — `FileUploader` (the picker), `FileRows` (download rows).

Tests: `tests/unit/files-*.test.ts`, `tests/unit/request-id.test.ts`, `tests/int/work-item-files.test.ts`.
