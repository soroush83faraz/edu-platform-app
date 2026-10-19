// files/paths — where an upload's bytes live: `<FILES_DIR>/<organization id>/<yyyy>/<file id>`. Every segment is
// made by the server (the organization from the session, the year from the clock, the file id a fresh UUID v7);
// nothing of the client's — not the name, not an extension — ever reaches a path, so there is no traversal to guard
// against. The key is still re-validated on every resolve (defense in depth; the database CHECKs the same shape,
// `file_object_storage_key_chk`, migration 0024). Pure — no `env`, the root is passed in (unit-tested).
import path from "node:path";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_RE = new RegExp(`^${UUID}$`);
/** = the CHECK of `files.file_object.storage_key`. */
export const STORAGE_KEY_RE = new RegExp(`^${UUID}/[0-9]{4}/${UUID}$`);

/** Uploads land here first (same volume as the final place, so the move is an atomic rename). */
export const TEMP_DIR_NAME = ".tmp";

export function storageKeyFor(orgId: string, fileId: string, at: Date): string {
  const org = orgId.toLowerCase();
  const id = fileId.toLowerCase();
  if (!UUID_RE.test(org) || !UUID_RE.test(id)) throw new Error("storageKeyFor: ids must be UUIDs");
  const year = at.getUTCFullYear();
  if (year < 2000 || year > 9999) throw new Error("storageKeyFor: year out of range");
  return `${org}/${year}/${id}`;
}

/** The absolute path of a key under `root`; throws on any key that is not exactly the server's own shape. */
export function storagePathIn(root: string, key: string): string {
  if (!STORAGE_KEY_RE.test(key)) throw new Error("storagePathIn: malformed storage key");
  const base = path.resolve(root);
  const full = path.resolve(base, ...key.split("/"));
  if (!full.startsWith(base + path.sep)) throw new Error("storagePathIn: key escapes the files root");
  return full;
}

export function tempDirIn(root: string): string {
  return path.join(path.resolve(root), TEMP_DIR_NAME);
}
