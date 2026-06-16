/**
 * Content hashing. File hashes use raw bytes with no EOL normalization; the
 * directory digest gives local sources a stable change signal for `update`.
 *
 * @see docs/04-data-formats.md §Hashing rules
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { posixify } from "../utils/fs.js";

/** Lowercase hex SHA-256 of a file's raw bytes (no newline normalization). */
export function hashFile(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

/** Lowercase hex SHA-256 of an in-memory buffer/string. */
export function hashBytes(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

interface DigestOptions {
  /** Directory names to skip entirely (e.g. ".git", "node_modules"). */
  exclude?: string[];
}

/**
 * Directory digest: walk `dir`, skip excluded dir names, sort entries by POSIX
 * relpath, then digest `concat(relpath + "\0" + filehash + "\n")`. Stable under
 * file-order shuffle; changes on rename or content change.
 */
export function directoryDigest(dir: string, options: DigestOptions = {}): string {
  const exclude = new Set(options.exclude ?? [".git"]);
  const files: { rel: string; abs: string }[] = [];

  const walk = (current: string): void => {
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (exclude.has(entry.name)) continue;
        walk(path.join(current, entry.name));
      } else if (entry.isFile()) {
        const abs = path.join(current, entry.name);
        files.push({ rel: posixify(path.relative(dir, abs)), abs });
      }
    }
  };
  walk(dir);

  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const hash = createHash("sha256");
  for (const f of files) {
    hash.update(`${f.rel}\0${hashFile(f.abs)}\n`);
  }
  return hash.digest("hex");
}
