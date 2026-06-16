/**
 * `contexts status` — recompute per-entry truth from disk (never trusting the
 * meta sidecar). Read-only; exit 0 when clean, exit 5 when any problem is found.
 *
 * @see docs/03-cli-reference.md §status
 */
import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { lsRemote } from "../core/git.js";
import { hashFile } from "../core/hash.js";
import { type LockEntry, type LockFile, readLock } from "../core/lockfile.js";
import * as reporter from "../ui/reporter.js";
import { ExitCode } from "../utils/errors.js";

export interface StatusOptions {
  remote?: boolean;
  json?: boolean;
  yes?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
}

type State = "ok" | "modified" | "broken" | "missing" | "drifted" | "stale";

interface EntryStatus {
  target: string;
  linkName: string;
  linkMode: LockEntry["linkMode"];
  state: State;
}

const FIXES: Record<State, string> = {
  ok: "",
  modified: "run `contexts install --force` to restore, or `contexts update` to accept upstream",
  broken: "run `contexts install` to rebuild the cache and links",
  missing: "run `contexts install` to recreate",
  drifted: "the target directory is gone — remove the mapping or recreate the directory",
  stale: "run `contexts update` to pull the newer upstream",
};

export async function statusCommand(opts: StatusOptions): Promise<void> {
  const cwd = process.cwd();
  const lock = await readLock(cwd);

  if (!lock || Object.keys(lock.contexts).length === 0) {
    reporter.info("no contexts installed — nothing to check");
    reporter.json({ command: "status", entries: [] });
    return;
  }

  const statuses: EntryStatus[] = [];
  for (const [target, entry] of Object.entries(lock.contexts)) {
    for (const linkName of entry.linkedAs) {
      statuses.push({
        target,
        linkName,
        linkMode: entry.linkMode,
        state: classifyOnDisk(cwd, target, linkName, entry),
      });
    }
  }

  if (opts.remote) {
    await applyRemoteStaleness(lock, statuses);
  }

  emit(statuses);
  if (statuses.some((s) => s.state !== "ok")) process.exitCode = ExitCode.Findings;
}

function classifyOnDisk(cwd: string, target: string, linkName: string, entry: LockEntry): State {
  const targetDir = target === "." ? cwd : path.join(cwd, target);
  if (!existsSync(targetDir) || !statSync(targetDir).isDirectory()) return "drifted";

  const linkPath = path.join(targetDir, linkName);
  let st: ReturnType<typeof lstatSync>;
  try {
    st = lstatSync(linkPath);
  } catch {
    return "missing";
  }

  if (st.isSymbolicLink()) {
    let resolved: string;
    try {
      resolved = realpathSync(linkPath);
    } catch {
      return "broken";
    }
    if (!existsSync(resolved)) return "broken";
    return hashFile(resolved) === entry.computedHash ? "ok" : "modified";
  }

  if (st.isFile()) {
    return hashFile(linkPath) === entry.computedHash ? "ok" : "modified";
  }

  return "modified";
}

/** Mark otherwise-ok entries `stale` when their source's upstream HEAD moved. */
async function applyRemoteStaleness(lock: LockFile, statuses: EntryStatus[]): Promise<void> {
  const staleSources = new Set<string>();
  const checked = new Set<string>();

  for (const entry of Object.values(lock.contexts)) {
    if (checked.has(entry.source)) continue;
    checked.add(entry.source);
    if (entry.sourceType === "local" || !entry.resolvedRef) continue;
    const url =
      entry.sourceType === "github" ? `https://github.com/${entry.source}.git` : entry.source;
    try {
      const head = await lsRemote(url);
      if (head !== entry.resolvedRef) staleSources.add(entry.source);
    } catch (err) {
      reporter.warn(`could not check upstream for ${entry.source}: ${(err as Error).message}`);
    }
  }

  if (staleSources.size === 0) return;
  const sourceByTarget = new Map(
    Object.entries(lock.contexts).map(([target, e]) => [target, e.source]),
  );
  for (const s of statuses) {
    if (s.state === "ok" && staleSources.has(sourceByTarget.get(s.target) ?? "")) {
      s.state = "stale";
    }
  }
}

function emit(statuses: EntryStatus[]): void {
  if (reporter.isJsonMode()) {
    reporter.json({ command: "status", entries: statuses });
    return;
  }
  reporter.table(
    ["target", "link", "mode", "state"],
    statuses.map((s) => [s.target, s.linkName, s.linkMode, colorState(s.state)]),
  );
  const states = new Set(statuses.map((s) => s.state));
  for (const state of states) {
    if (state !== "ok" && FIXES[state]) reporter.info(`${state}: ${FIXES[state]}`);
  }
}

function colorState(state: State): string {
  return state;
}
