/**
 * `contexts reset` — remove all symlinked agent files installed by contexts and
 * restore original `.bak` backups to their initial locations. Cleans up
 * `contexts.lock` and `.contexts/` cache so the project returns to pre-`add`
 * state.
 *
 * Ownership check mirrors `linker.ts` ownsPath: only removes files we are
 * confident contexts created (symlinks into cache, or regular files whose hash
 * matches the lock). Foreign files are left untouched with a warning.
 *
 * @see docs/03-cli-reference.md §reset
 */
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import path from "node:path";
import { hashFile } from "../core/hash.js";
import { type LockEntry, readLock } from "../core/lockfile.js";
import { clack } from "../ui/prompts.js";
import * as reporter from "../ui/reporter.js";
import { CliError, ExitCode } from "../utils/errors.js";
import { isInteractive } from "../utils/platform.js";

export interface ResetOptions {
  json?: boolean;
  yes?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
}

interface ResetResult {
  removed: number;
  restored: number;
  kept: number;
}

export async function resetCommand(opts: ResetOptions): Promise<void> {
  const cwd = process.cwd();
  const lock = await readLock(cwd);

  if (!lock || Object.keys(lock.contexts).length === 0) {
    reporter.info("no contexts.lock found — nothing to reset");
    reporter.json({
      command: "reset",
      removed: 0,
      restored: 0,
      kept: 0,
      status: "nothing-to-reset",
    });
    return;
  }

  const cacheRoot = path.join(cwd, ".contexts", "cache");
  const result = computeReset(lock.contexts, cwd, cacheRoot);

  if (result.removed === 0 && result.restored === 0 && result.kept === 0) {
    reporter.info("nothing to reset — no links or backups found");
    reporter.json({ command: "reset", ...result, status: "nothing-to-reset" });
    return;
  }

  if (opts.dryRun) {
    reporter.info(
      `dry run — would remove ${result.removed} link(s) and restore ${result.restored} backup(s)${result.kept > 0 ? `, keep ${result.kept} foreign file(s)` : ""}`,
    );
    reporter.json({ command: "reset", ...result, status: "dry-run" });
    return;
  }

  if (!(await confirmReset(opts, result))) {
    reporter.info("reset cancelled");
    return;
  }

  await executeReset(lock.contexts, cwd, cacheRoot);
  const leftoverBaks = findLeftoverBaks(lock.contexts, cwd);

  // Remove lock and cache.
  await rm(path.join(cwd, "contexts.lock"), { force: true });
  await rm(path.join(cwd, ".contexts"), { recursive: true, force: true });

  if (leftoverBaks.length > 0) {
    reporter.warn(`leftover backup files not restored (will remain): ${leftoverBaks.join(", ")}`);
  }

  reporter.json({ command: "reset", ...result, status: "reset" });
  reporter.outro(
    `removed ${result.removed} link(s), restored ${result.restored} backup(s)${result.kept > 0 ? `, kept ${result.kept} foreign file(s)` : ""}`,
  );
}

/** Dry-run-compatible computation: count what would be removed/restored/kept. */
function computeReset(
  entries: Record<string, LockEntry>,
  projectRoot: string,
  cacheRoot: string,
): ResetResult {
  let removed = 0;
  let restored = 0;
  let kept = 0;

  for (const [target, entry] of Object.entries(entries)) {
    for (const linkName of entry.linkedAs) {
      const linkPath = path.join(projectRoot, target, linkName);
      const bakPath = `${linkPath}.bak`;
      const hasBak = existsSync(bakPath);
      const owned = ownsLinkPath(linkPath, entry.computedHash, cacheRoot);

      if (hasBak || owned) {
        // We'll remove the file at linkPath to either restore .bak or just clean up.
        if (owned || existsSync(linkPath)) removed++;
      } else if (existsSync(linkPath)) {
        kept++;
      }
      if (hasBak) restored++;
    }
  }

  return { removed, restored, kept };
}

/** Execute reset: remove owned links, restore .bak backups. */
async function executeReset(
  entries: Record<string, LockEntry>,
  projectRoot: string,
  cacheRoot: string,
): Promise<void> {
  for (const [target, entry] of Object.entries(entries)) {
    for (const linkName of entry.linkedAs) {
      const linkPath = path.join(projectRoot, target, linkName);
      const bakPath = `${linkPath}.bak`;
      const hasBak = existsSync(bakPath);
      const owned = ownsLinkPath(linkPath, entry.computedHash, cacheRoot);

      if (!hasBak && !owned) continue; // foreign file with no backup — preserve

      await removeIfPresent(linkPath);
      if (hasBak) {
        await rename(bakPath, linkPath);
      }
    }
  }
}

/** Find any `.bak.N` (N≥2) leftover files that will not be restored. */
function findLeftoverBaks(entries: Record<string, LockEntry>, projectRoot: string): string[] {
  const leftovers: string[] = [];
  for (const [target, entry] of Object.entries(entries)) {
    for (const linkName of entry.linkedAs) {
      const linkPath = path.join(projectRoot, target, linkName);
      for (let n = 2; ; n++) {
        const extraBak = `${linkPath}.bak.${n}`;
        if (existsSync(extraBak)) {
          leftovers.push(path.relative(projectRoot, extraBak));
        } else {
          break;
        }
      }
    }
  }
  return leftovers;
}

/**
 * Ownership check mirroring `linker.ts` ownsPath:
 * - Symlink resolving into the cache root → ours.
 * - Regular file whose hash matches the recorded lock hash → ours (copy-mode).
 * - Anything else → not ours.
 */
function ownsLinkPath(linkPath: string, computedHash: string, cacheRoot: string): boolean {
  let st: ReturnType<typeof lstatSync>;
  try {
    st = lstatSync(linkPath);
  } catch {
    return false;
  }
  if (st.isSymbolicLink()) {
    try {
      return realpathSync(linkPath).startsWith(realpathSync(cacheRoot));
    } catch {
      return false;
    }
  }
  if (st.isFile()) {
    try {
      return hashFile(linkPath) === computedHash;
    } catch {
      return false;
    }
  }
  return false;
}

async function removeIfPresent(p: string): Promise<void> {
  try {
    await rm(p, { force: true });
  } catch {
    // ignore
  }
}

async function confirmReset(opts: ResetOptions, result: ResetResult): Promise<boolean> {
  if (opts.yes) return true;
  if (!isInteractive(opts)) {
    throw new CliError(
      ExitCode.Usage,
      "reset requires confirmation in non-interactive mode",
      "use --yes to skip the prompt",
    );
  }
  const msg = `This will remove ${result.removed} link(s) and restore ${result.restored} backup(s). Proceed?`;
  const answer = await clack.confirm({ message: msg });
  return answer === true;
}
