/**
 * Linking engine: pure `planLinks` (classification, used by `--dry-run` and
 * tests) then `executeLinks` (mutation, with copy fallback). `pruneOrphans`
 * removes links that vanished from the desired state — only when we own them.
 *
 * Links are stored as **relative** symlinks so the project is position-
 * independent on disk. Symlink failure (restricted FS, Windows without
 * Developer Mode) falls back to a recorded file copy.
 *
 * @see docs/06-linking-engine.md
 */
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { access, copyFile, mkdir, readlink, rm, symlink } from "node:fs/promises";
import path from "node:path";
import type { ExecutedOp, LinkMode, LinkOperation, LinkSelection } from "../types.js";
import * as reporter from "../ui/reporter.js";
import { CliError, ExitCode } from "../utils/errors.js";
import { hashFile } from "./hash.js";

/** A previously-recorded link, used for owned-artifact detection + pruning. */
export interface KnownLink {
  target: string;
  linkName: string;
  /** Expected content hash of a copy-mode artifact we own. */
  computedHash: string;
}

const FALLBACK_CODES = new Set(["EPERM", "EACCES", "ENOSYS", "UNKNOWN"]);

/**
 * Indirection over `fs.symlink` so tests can force the copy-fallback path
 * (ESM named imports can't be spied). Production always uses the real symlink.
 */
type SymlinkFn = (target: string, linkPath: string, type: "file") => Promise<void>;
let symlinkImpl: SymlinkFn = (target, linkPath, type) => symlink(target, linkPath, type);

/** Test-only: override the symlink implementation (e.g. to throw EPERM). */
export function _setSymlinkImpl(fn: SymlinkFn | null): void {
  symlinkImpl = fn ?? ((target, linkPath, type) => symlink(target, linkPath, type));
}

function linkPathFor(projectRoot: string, target: string, linkName: string): string {
  return target === "."
    ? path.join(projectRoot, linkName)
    : path.join(projectRoot, target, linkName);
}

/** Build a lookup of owned content hashes keyed by `target\0linkName`. */
function knownHashIndex(known: KnownLink[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const k of known ?? []) map.set(`${k.target}\0${k.linkName}`, k.computedHash);
  return map;
}

/**
 * Pure planner. Classifies each (selection × linkName) against what's currently
 * on disk. `known` lets a copy-mode artifact we previously installed classify as
 * `replace-link` (re-link) rather than `conflict`.
 */
export function planLinks(
  selections: LinkSelection[],
  cacheDir: string,
  projectRoot: string,
  options: { mode?: LinkMode; known?: KnownLink[] } = {},
): LinkOperation[] {
  const mode: LinkMode = options.mode ?? "symlink";
  const ownedHashes = knownHashIndex(options.known);
  const ops: LinkOperation[] = [];

  for (const sel of selections) {
    for (const linkName of sel.linkNames) {
      const linkPath = linkPathFor(projectRoot, sel.target, linkName);
      const cachedFile = path.join(cacheDir, sel.contextPath);
      const relTarget = path.relative(path.dirname(linkPath), cachedFile);
      const owned = ownedHashes.get(`${sel.target}\0${linkName}`);
      ops.push({
        target: sel.target,
        linkName,
        linkPath,
        cachedFile,
        relTarget,
        action: classify(linkPath, cachedFile, owned),
        mode,
      });
    }
  }
  return ops;
}

function classify(
  linkPath: string,
  cachedFile: string,
  ownedHash: string | undefined,
): LinkOperation["action"] {
  let st: ReturnType<typeof lstatSync>;
  try {
    st = lstatSync(linkPath);
  } catch {
    return "create"; // nothing there
  }

  if (st.isSymbolicLink()) {
    try {
      const resolved = realpathSync(linkPath);
      if (resolved === realpathSync(cachedFile)) return "skip-ok";
    } catch {
      // dangling or unresolvable symlink → replace
    }
    return "replace-link";
  }

  if (st.isDirectory()) {
    throw new CliError(
      ExitCode.Usage,
      `${linkPath} is a directory; refusing to replace it`,
      "remove or rename that directory, then re-run",
    );
  }

  if (st.isFile()) {
    // A copy-mode artifact we own (hash matches the recorded lock entry).
    if (ownedHash !== undefined && safeHash(linkPath) === ownedHash) return "replace-link";
    return "conflict";
  }

  return "conflict";
}

function safeHash(p: string): string | undefined {
  try {
    return hashFile(p);
  } catch {
    return undefined;
  }
}

/** Conflict resolution choice (provided by the UI or scripted in tests). */
export type ConflictChoice = "backup" | "skip" | "abort";

export interface ExecuteOptions {
  /** Force copy mode instead of symlinks. */
  copy?: boolean;
  /**
   * Decide what to do with a `conflict` op. Defaults to skip (the safe
   * non-interactive policy). `--force` callers return "backup".
   */
  resolveConflict?: (op: LinkOperation) => Promise<ConflictChoice> | ConflictChoice;
}

/**
 * Execute planned ops. Returns the ops that actually happened, each annotated
 * with its real result and mode. Copy fallbacks are collected into a single
 * end-of-run warning.
 */
export async function executeLinks(
  ops: LinkOperation[],
  options: ExecuteOptions = {},
): Promise<ExecutedOp[]> {
  const resolveConflict = options.resolveConflict ?? (() => "skip" as const);
  const executed: ExecutedOp[] = [];
  let fallbackCount = 0;

  for (const op of ops) {
    if (op.action === "skip-ok") {
      executed.push({ ...op, result: "skipped" });
      continue;
    }

    let backupPath: string | undefined;
    if (op.action === "conflict") {
      const choice = await resolveConflict(op);
      if (choice === "abort") {
        throw new CliError(
          ExitCode.Usage,
          "aborted due to a conflicting file",
          `at ${op.linkPath}`,
        );
      }
      if (choice === "skip") {
        reporter.warn(`skipped ${rel(op.linkPath)} — a different file already exists there`);
        executed.push({ ...op, result: "skipped" });
        continue;
      }
      backupPath = await backupConflict(op.linkPath);
      reporter.warn(`backed up ${rel(op.linkPath)} → ${rel(backupPath)}`);
    }

    await mkdir(path.dirname(op.linkPath), { recursive: true });
    await removeIfPresent(op.linkPath);

    const wantCopy = options.copy || op.mode === "copy";
    let mode: LinkMode = wantCopy ? "copy" : "symlink";
    let fellBack = false;

    if (mode === "symlink") {
      try {
        await symlinkImpl(op.relTarget, op.linkPath, "file");
        await verifySymlink(op.linkPath);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code ?? "";
        if (FALLBACK_CODES.has(code)) {
          await copyFile(op.cachedFile, op.linkPath);
          mode = "copy";
          fellBack = true;
          fallbackCount++;
        } else {
          throw err;
        }
      }
    } else {
      await copyFile(op.cachedFile, op.linkPath);
    }

    const result: ExecutedOp["result"] =
      op.action === "create" ? "created" : op.action === "conflict" ? "replaced" : "replaced";
    executed.push({
      ...op,
      mode,
      result,
      ...(backupPath ? { backupPath } : {}),
      ...(fellBack ? { fellBack: true } : {}),
    });
  }

  if (fallbackCount > 0) {
    reporter.warn(
      `symlinks unavailable — ${fallbackCount} file(s) were copied; updates require re-running \`contexts update\`; enable Windows Developer Mode for symlinks`,
    );
  }

  return executed;
}

async function verifySymlink(linkPath: string): Promise<void> {
  const target = await readlink(linkPath);
  const resolved = path.resolve(path.dirname(linkPath), target);
  await access(resolved);
}

async function removeIfPresent(p: string): Promise<void> {
  try {
    await rm(p, { force: true });
  } catch {
    // ignore
  }
}

async function backupConflict(linkPath: string): Promise<string> {
  let candidate = `${linkPath}.bak`;
  let n = 2;
  while (existsSync(candidate)) {
    candidate = `${linkPath}.bak.${n++}`;
  }
  await copyFile(linkPath, candidate);
  return candidate;
}

/**
 * Compute orphan links (old (target×linkName) pairs absent from the new desired
 * set) and remove only those we own (a symlink resolving into the cache, or a
 * regular file hashing to the old recorded hash). Foreign files are left + warned.
 */
export async function pruneOrphans(
  oldLinks: KnownLink[],
  newLinks: KnownLink[],
  projectRoot: string,
  cacheRoot: string,
): Promise<{ removed: string[]; kept: string[] }> {
  const newSet = new Set(newLinks.map((l) => `${l.target}\0${l.linkName}`));
  const removed: string[] = [];
  const kept: string[] = [];

  for (const old of oldLinks) {
    if (newSet.has(`${old.target}\0${old.linkName}`)) continue;
    const linkPath = linkPathFor(projectRoot, old.target, old.linkName);
    if (!existsSync(linkPath) && !isSymlinkPresent(linkPath)) continue;

    if (ownsPath(linkPath, old.computedHash, cacheRoot)) {
      await removeIfPresent(linkPath);
      removed.push(rel(linkPath));
    } else {
      kept.push(rel(linkPath));
      reporter.warn(
        `not removing ${rel(linkPath)} — content doesn't match what contexts installed`,
      );
    }
  }
  return { removed, kept };
}

function isSymlinkPresent(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function ownsPath(linkPath: string, oldHash: string, cacheRoot: string): boolean {
  let st: ReturnType<typeof lstatSync>;
  try {
    st = lstatSync(linkPath);
  } catch {
    return false;
  }
  if (st.isSymbolicLink()) {
    try {
      const resolved = realpathSync(linkPath);
      return resolved.startsWith(realpathSync(cacheRoot));
    } catch {
      return false; // dangling symlink — don't assume ownership
    }
  }
  if (st.isFile()) {
    return safeHash(linkPath) === oldHash;
  }
  return false;
}

function rel(p: string): string {
  return path.relative(process.cwd(), p) || p;
}
