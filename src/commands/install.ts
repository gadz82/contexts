/**
 * `contexts install` — headless restore from `contexts.lock` (the `npm ci`
 * equivalent). Reads only the lock: re-fetch each source at its pinned ref,
 * verify content hashes, and rebuild links idempotently. No prompts ever.
 *
 * @see docs/03-cli-reference.md §install, docs/02-architecture.md §pipelines install
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { CacheService } from "../core/cache.js";
import { hashFile } from "../core/hash.js";
import { type KnownLink, executeLinks, planLinks } from "../core/linker.js";
import { type LockEntry, type LockFile, readLock, writeLock } from "../core/lockfile.js";
import { parseSource } from "../core/source.js";
import type { LinkSelection, ResolvedSource } from "../types.js";
import { spinner } from "../ui/prompts.js";
import * as reporter from "../ui/reporter.js";
import { CliError, ExitCode } from "../utils/errors.js";

export interface InstallOptions {
  force?: boolean;
  json?: boolean;
  yes?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
}

interface Mismatch {
  target: string;
  expected: string;
  actual: string;
}

export async function installCommand(opts: InstallOptions): Promise<void> {
  const cwd = process.cwd();
  const lock = await readLock(cwd);
  if (!lock) {
    throw new CliError(
      ExitCode.Lock,
      "no contexts.lock found",
      "run `contexts add <source>` first",
    );
  }

  const entriesByTarget = Object.entries(lock.contexts);
  if (entriesByTarget.length === 0) {
    reporter.info("contexts.lock has no entries — nothing to install");
    reporter.json({ command: "install", restored: 0, verified: 0, skipped: 0, status: "empty" });
    return;
  }

  // Group targets by source so each source is materialized exactly once.
  const cache = new CacheService(cwd);
  const cacheDirBySource = new Map<string, string>();
  const refBySource = new Map<string, string | null>();
  const mismatches: Mismatch[] = [];

  for (const [, entry] of entriesByTarget) {
    if (cacheDirBySource.has(entry.source)) continue;
    const resolved = resolvedFromLock(entry);
    const sp = spinner(`fetching ${entry.source}`);
    try {
      const materialized = await cache.materialize(resolved, { pinnedRef: entry.resolvedRef });
      cacheDirBySource.set(entry.source, materialized.cacheDir);
      refBySource.set(entry.source, materialized.resolvedRef);
    } finally {
      sp.stop(`fetched ${entry.source}`);
    }
  }

  // Verify every entry's content hash against the lock.
  for (const [target, entry] of entriesByTarget) {
    const cacheDir = cacheDirBySource.get(entry.source) as string;
    const file = path.join(cacheDir, entry.contextPath);
    const actual = existsSync(file) ? hashFile(file) : "<missing>";
    if (actual !== entry.computedHash) {
      mismatches.push({ target, expected: entry.computedHash, actual });
    }
  }

  if (mismatches.length > 0) {
    if (!opts.force) {
      const lines = mismatches.map((m) => `  ${m.target}: ${m.expected} ≠ ${m.actual}`).join("\n");
      throw new CliError(
        ExitCode.Lock,
        `content hash mismatch for ${mismatches.length} entr(y/ies):\n${lines}`,
        "the source changed since this lock was written; run `contexts update`, or `contexts install --force` to re-pin",
      );
    }
    // --force: re-pin the lock to fetched reality.
    repin(lock, cacheDirBySource, refBySource);
    await writeLock(cwd, lock);
    reporter.warn(`re-pinned ${mismatches.length} entr(y/ies) to fetched content (--force)`);
  }

  // Rebuild links idempotently. Foreign conflicting files are skipped + warned.
  let restored = 0;
  let verified = 0;
  let skipped = 0;
  for (const [target, entry] of entriesByTarget) {
    const cacheDir = cacheDirBySource.get(entry.source) as string;
    const selection: LinkSelection = {
      target,
      contextPath: entry.contextPath,
      linkNames: entry.linkedAs,
    };
    const known: KnownLink[] = entry.linkedAs.map((linkName) => ({
      target,
      linkName,
      computedHash: entry.computedHash,
    }));
    const plan = planLinks([selection], cacheDir, cwd, { mode: entry.linkMode, known });
    const executed = await executeLinks(plan, {
      copy: entry.linkMode === "copy",
      resolveConflict: () => "skip",
    });
    for (const op of executed) {
      if (op.result === "skipped" && op.action === "skip-ok") verified++;
      else if (op.result === "skipped") skipped++;
      else restored++;
    }
  }

  reporter.json({ command: "install", restored, verified, skipped, status: "installed" });
  reporter.info(`restored ${restored}, verified ${verified}, skipped ${skipped}`);
  reporter.outro("install complete");
}

/** Reconstruct a {@link ResolvedSource} from a lock entry for re-materialization. */
function resolvedFromLock(entry: LockEntry): ResolvedSource {
  if (entry.sourceType === "local") {
    // Validate the path is well-formed; the cache service checks existence.
    return parseSourceLocal(entry.source);
  }
  if (entry.sourceType === "github") {
    return {
      raw: entry.source,
      source: entry.source,
      sourceType: "github",
      fetchUrl: `https://github.com/${entry.source}.git`,
      requestedRef: entry.resolvedRef,
      subpath: entry.subpath ?? null,
      localPath: null,
    };
  }
  return {
    raw: entry.source,
    source: entry.source,
    sourceType: "git",
    fetchUrl: entry.source,
    requestedRef: entry.resolvedRef,
    subpath: entry.subpath ?? null,
    localPath: null,
  };
}

function parseSourceLocal(source: string): ResolvedSource {
  // Local lock sources are absolute paths; parseSource resolves + classifies.
  const resolved = parseSource(source, process.cwd());
  if (resolved.sourceType !== "local") {
    throw new CliError(
      ExitCode.Lock,
      `lock source "${source}" is not a usable local path on this machine`,
      "local-source locks are machine-specific; consider moving the contexts repo to git",
    );
  }
  return resolved;
}

function repin(
  lock: LockFile,
  cacheDirBySource: Map<string, string>,
  refBySource: Map<string, string | null>,
): void {
  for (const [, entry] of Object.entries(lock.contexts)) {
    const cacheDir = cacheDirBySource.get(entry.source);
    if (!cacheDir) continue;
    const file = path.join(cacheDir, entry.contextPath);
    if (existsSync(file)) entry.computedHash = hashFile(file);
    entry.resolvedRef = refBySource.get(entry.source) ?? entry.resolvedRef;
  }
}
