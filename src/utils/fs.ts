/**
 * Filesystem helpers: atomic write, existence check, POSIX path conversion,
 * directory ensure.
 *
 * @see docs/02-architecture.md §Invariants (atomic lock write)
 * @see docs/06-linking-engine.md §Windows specifics (POSIX normalization)
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { lstat } from "node:fs/promises";
import path from "node:path";

/** Ensure a directory exists (recursive, no error if present). */
export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

/** True if a path exists (file, dir, or symlink — uses lstat). */
export async function exists(p: string): Promise<boolean> {
  try {
    await lstat(p);
    return true;
  } catch {
    return false;
  }
}

/** Convert any path to POSIX separators (for lock keys / contextPath). */
export function posixify(p: string): string {
  return p.split(path.sep).join("/").split("\\").join("/");
}

/**
 * Write a file atomically: write to a temp sibling then rename over the target.
 * Rename is atomic within a filesystem, so readers never see a partial file.
 */
export function atomicWrite(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    writeFileSync(tmp, content);
    renameSync(tmp, filePath);
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // best-effort cleanup
    }
    throw err;
  }
}
