/**
 * `contexts update [targets...]` — fetch upstream, diff, apply, re-pin.
 *
 * Per source: detect whether upstream moved (git HEAD via ls-remote, or local
 * directory digest). Changed sources are re-materialized, per-entry hashes
 * diffed, and (after confirmation unless --yes) re-linked with refreshed
 * `resolvedRef`/`computedHash`. Mappings that vanished upstream are pruned with
 * ownership checks; new mappings are surfaced as available via `add`.
 *
 * @see docs/03-cli-reference.md §update, docs/02-architecture.md §pipelines update
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { CacheService } from "../core/cache.js";
import { lsRemote } from "../core/git.js";
import { directoryDigest, hashFile } from "../core/hash.js";
import { type KnownLink, executeLinks, planLinks, pruneOrphans } from "../core/linker.js";
import { type LockEntry, type LockFile, readLock, writeLock } from "../core/lockfile.js";
import { loadManifest, resolveMappings } from "../core/manifest.js";
import type { LinkSelection, ResolvedSource } from "../types.js";
import { clack, spinner } from "../ui/prompts.js";
import * as reporter from "../ui/reporter.js";
import { CliError, ExitCode } from "../utils/errors.js";
import { isInteractive } from "../utils/platform.js";

export interface UpdateOptions {
  check?: boolean;
  tag?: string;
  json?: boolean;
  yes?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
}

interface DiffRow {
  target: string;
  oldHash: string;
  newHash: string;
  changed: boolean;
}

export async function updateCommand(targets: string[], opts: UpdateOptions): Promise<void> {
  const cwd = process.cwd();
  const lock = await readLock(cwd);
  if (!lock || Object.keys(lock.contexts).length === 0) {
    throw new CliError(
      ExitCode.Lock,
      "no contexts.lock found",
      "run `contexts add <source>` first",
    );
  }

  const considered = filterEntries(lock, targets);
  const cache = new CacheService(cwd);

  // `--tag default` is the reserved keyword that rolls back to the root
  // (untagged) mappings; any other value selects that named tag.
  const clearTag = opts.tag === "default";

  // One representative entry per source, restricted to considered entries.
  const repBySource = new Map<string, LockEntry>();
  for (const [, entry] of considered) {
    if (!repBySource.has(entry.source)) repBySource.set(entry.source, entry);
  }

  // Detect which sources changed upstream.
  const changedSources = new Set<string>();
  for (const [source, rep] of repBySource) {
    const changed = await sourceChanged(rep, cache);
    // An explicit --tag forces re-resolution so the context can be switched even
    // when upstream itself is unchanged.
    if (changed || opts.tag) changedSources.add(source);
    else reporter.info(`${source}: up-to-date`);
  }

  if (opts.check) {
    if (changedSources.size > 0) {
      reporter.info(`${changedSources.size} source(s) have updates available`);
      reporter.json({ command: "update", check: true, updatesAvailable: true });
      process.exitCode = ExitCode.Findings;
    } else {
      reporter.json({ command: "update", check: true, updatesAvailable: false });
    }
    return;
  }

  if (changedSources.size === 0) {
    reporter.info("everything is up-to-date");
    reporter.json({ command: "update", applied: 0, status: "up-to-date" });
    return;
  }

  // Re-materialize each changed source and compute the diff.
  const diffs: DiffRow[] = [];
  const orphans: KnownLink[] = [];
  const newRefBySource = new Map<string, string | null>();
  const cacheDirBySource = new Map<string, string>();
  const newContextPathByTarget = new Map<string, string>();
  const newMappings: string[] = [];

  for (const source of changedSources) {
    const rep = repBySource.get(source) as LockEntry;
    const resolved = resolvedForUpdate(rep);
    const sp = spinner(`fetching ${source}`);
    let cacheDir: string;
    let newRef: string | null;
    try {
      const m = await cache.materialize(resolved);
      cacheDir = m.cacheDir;
      newRef = m.resolvedRef;
    } finally {
      sp.stop(`fetched ${source}`);
    }
    cacheDirBySource.set(source, cacheDir);
    newRefBySource.set(source, newRef);

    const manifest = loadManifest(cacheDir);
    const lockTargets = new Set(Object.keys(lock.contexts));
    for (const m of manifest.mappings) {
      if (!lockTargets.has(m.target)) newMappings.push(m.target);
    }

    for (const [target, entry] of considered) {
      if (entry.source !== source) continue;
      // Resolve under the active tag: an explicit --tag switches; else keep the
      // entry's recorded tag. resolveMappings throws exit 2 on an unknown tag.
      const eTag = clearTag ? null : (opts.tag ?? entry.tag ?? null);
      const mapping = resolveMappings(manifest, eTag).find((m) => m.target === target);
      const file = mapping ? path.join(cacheDir, mapping.contextPath) : "";
      // Orphan = the mapping is gone upstream (under this tag), or its file vanished.
      if (!mapping || !existsSync(file)) {
        for (const linkName of entry.linkedAs) {
          orphans.push({ target, linkName, computedHash: entry.computedHash });
        }
        diffs.push({ target, oldHash: entry.computedHash, newHash: "<removed>", changed: true });
        continue;
      }
      newContextPathByTarget.set(target, mapping.contextPath);
      const newHash = hashFile(file);
      diffs.push({
        target,
        oldHash: entry.computedHash,
        newHash,
        changed: newHash !== entry.computedHash || mapping.contextPath !== entry.contextPath,
      });
    }
  }

  printDiff(diffs);
  if (newMappings.length > 0) {
    reporter.info(
      `new upstream mappings available via \`contexts add\`: ${newMappings.join(", ")}`,
    );
  }

  if (!(await confirmApply(opts))) {
    reporter.info("update cancelled");
    return;
  }

  // Apply: re-link changed entries, refresh ref+hash, prune orphans.
  let applied = 0;
  const orphanTargets = new Set(orphans.map((o) => o.target));
  for (const [target, entry] of considered) {
    if (!changedSources.has(entry.source) || orphanTargets.has(target)) continue;
    const cacheDir = cacheDirBySource.get(entry.source) as string;
    const newContextPath = newContextPathByTarget.get(target) ?? entry.contextPath;
    const file = path.join(cacheDir, newContextPath);
    const newHash = hashFile(file);
    const newRef = newRefBySource.get(entry.source) ?? entry.resolvedRef;
    const contentChanged = newHash !== entry.computedHash || newContextPath !== entry.contextPath;

    if (contentChanged) {
      const selection: LinkSelection = {
        target,
        contextPath: newContextPath,
        linkNames: entry.linkedAs,
      };
      const known: KnownLink[] = entry.linkedAs.map((linkName) => ({
        target,
        linkName,
        computedHash: entry.computedHash,
      }));
      const plan = planLinks([selection], cacheDir, cwd, { mode: entry.linkMode, known });
      await executeLinks(plan, { copy: entry.linkMode === "copy", resolveConflict: () => "skip" });
      applied++;
    }
    entry.contextPath = newContextPath;
    entry.computedHash = newHash;
    entry.resolvedRef = newRef;
    // --tag switches the recorded context; `default` clears it back to root.
    // (undefined is dropped by JSON.stringify, so the lock key disappears.)
    if (clearTag) entry.tag = undefined;
    else if (opts.tag) entry.tag = opts.tag;
  }

  // Prune orphans (ownership-checked) and drop them from the lock.
  if (orphans.length > 0) {
    await pruneOrphans(orphans, [], cwd, cache.cacheRoot);
    for (const target of orphanTargets) delete lock.contexts[target];
  }

  await writeLock(cwd, lock);

  reporter.json({
    command: "update",
    applied,
    pruned: orphans.length,
    status: "applied",
  });
  reporter.outro(`updated ${applied} entr(y/ies), pruned ${orphanTargets.size}`);
}

function filterEntries(lock: LockFile, targets: string[]): [string, LockEntry][] {
  const all = Object.entries(lock.contexts);
  if (targets.length === 0) return all;
  const known = new Set(all.map(([t]) => t));
  const unknown = targets.filter((t) => !known.has(t));
  if (unknown.length > 0) {
    throw new CliError(
      ExitCode.Usage,
      `unknown target ${unknown.map((u) => `"${u}"`).join(", ")}`,
      `lock targets: ${[...known].join(", ")}`,
    );
  }
  return all.filter(([t]) => targets.includes(t));
}

async function sourceChanged(rep: LockEntry, cache: CacheService): Promise<boolean> {
  if (rep.sourceType === "local") {
    const resolved = resolvedForUpdate(rep);
    const localPath = resolved.localPath as string;
    if (!existsSync(localPath)) return true;
    const newDigest = directoryDigest(localPath, { exclude: [".git", "node_modules"] });
    const oldDigest = readMetaDigest(cache.cacheDirFor(resolved));
    return oldDigest === null || newDigest !== oldDigest;
  }
  const url = rep.sourceType === "github" ? `https://github.com/${rep.source}.git` : rep.source;
  try {
    const head = await lsRemote(url);
    return head !== rep.resolvedRef;
  } catch (err) {
    reporter.warn(`could not check upstream for ${rep.source}: ${(err as Error).message}`);
    return false;
  }
}

function readMetaDigest(cacheDir: string): string | null {
  try {
    const meta = JSON.parse(readFileSync(path.join(cacheDir, ".contexts-meta.json"), "utf8"));
    return typeof meta.directoryDigest === "string" ? meta.directoryDigest : null;
  } catch {
    return null;
  }
}

function resolvedForUpdate(entry: LockEntry): ResolvedSource {
  if (entry.sourceType === "local") {
    return {
      raw: entry.source,
      source: entry.source,
      sourceType: "local",
      fetchUrl: null,
      requestedRef: null,
      subpath: null,
      localPath: entry.source,
    };
  }
  const fetchUrl =
    entry.sourceType === "github" ? `https://github.com/${entry.source}.git` : entry.source;
  return {
    raw: entry.source,
    source: entry.source,
    sourceType: entry.sourceType,
    fetchUrl,
    requestedRef: null, // fetch the latest HEAD, not the pinned ref
    subpath: entry.subpath ?? null,
    localPath: null,
  };
}

function printDiff(diffs: DiffRow[]): void {
  if (reporter.isJsonMode()) {
    reporter.json({ command: "update", diff: diffs });
    return;
  }
  reporter.table(
    ["target", "old", "new", "changed"],
    diffs.map((d) => [
      d.target,
      d.oldHash.slice(0, 7),
      d.newHash.startsWith("<") ? d.newHash : d.newHash.slice(0, 7),
      d.changed ? "yes" : "no",
    ]),
  );
}

async function confirmApply(opts: UpdateOptions): Promise<boolean> {
  if (opts.yes) return true;
  if (!isInteractive(opts)) return true; // non-interactive: proceed (intent is explicit)
  const answer = await clack.confirm({ message: "Apply these updates?" });
  return answer === true;
}
