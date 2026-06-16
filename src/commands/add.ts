/**
 * `contexts add <source>` — fetch a contexts repo, select mappings, create
 * links. Lock writing lands in phase 5.
 *
 * Orchestration only: this composes core services (cache, manifest, linker) and
 * the UI; it performs no fs/git work directly.
 *
 * @see docs/02-architecture.md §pipelines `add`, docs/03-cli-reference.md §add
 */
import path from "node:path";
import { CacheService } from "../core/cache.js";
import { hashFile } from "../core/hash.js";
import { type ConflictChoice, executeLinks, planLinks } from "../core/linker.js";
import { type LockEntry, mergeEntries, readLock, writeLock } from "../core/lockfile.js";
import { type ManifestMapping, diagnose, loadManifest, resolveMappings } from "../core/manifest.js";
import { parseSource } from "../core/source.js";
import type {
  ExecutedOp,
  LinkOperation,
  LinkSelection,
  MappingDiagnostic,
  ResolvedSource,
} from "../types.js";
import { resolveConflictPrompt, selectLinkNames, selectMappings, spinner } from "../ui/prompts.js";
import * as reporter from "../ui/reporter.js";
import { CliError, ExitCode } from "../utils/errors.js";
import { posixify } from "../utils/fs.js";
import { ensureIgnored } from "../utils/gitignore.js";
import { DEFAULT_LINK_NAME, isValidLinkName } from "../utils/linkname.js";
import { isInteractive } from "../utils/platform.js";

export interface AddOptions {
  target?: string[];
  linkAs?: string[];
  copy?: boolean;
  force?: boolean;
  includeDrifted?: boolean;
  tag?: string;
  json?: boolean;
  yes?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
}

export async function addCommand(source: string, opts: AddOptions): Promise<void> {
  const cwd = process.cwd();
  const resolved = parseSource(source, cwd);

  const sp = spinner(`fetching ${resolved.source}`);
  let materialized: Awaited<ReturnType<CacheService["materialize"]>>;
  try {
    materialized = await new CacheService(cwd).materialize(resolved);
  } finally {
    sp.stop(`fetched ${resolved.source}`);
  }

  await ensureIgnored(cwd);

  const relCache = posixify(path.relative(cwd, materialized.cacheDir));
  const shortRef = materialized.resolvedRef ? ` (ref ${materialized.resolvedRef.slice(0, 7)})` : "";
  reporter.info(`contexts cached at ${relCache}${shortRef}`);

  const manifest = loadManifest(materialized.cacheDir);
  const tag = opts.tag ?? null;
  // Validates the tag (throws exit 2 on unknown) and resolves effective mappings.
  const effective = resolveMappings(manifest, tag);
  const diagnostics = diagnose(manifest, cwd, tag);
  if (tag) reporter.info(`using tag "${tag}"`);

  const requested = normalizeRequestedTargets(opts.target);
  if (requested && !requested.all) assertKnownTargets(requested.values, diagnostics);
  const selectable = computeSelectable(diagnostics, requested, Boolean(opts.includeDrifted));

  reporter.printDiagnostics(diagnostics);

  if (selectable.length === 0) {
    reporter.warn("no mappings to link (drifted mappings need --include-drifted)");
    reporter.json({ command: "add", linked: [], skipped: [], status: "nothing-to-link" });
    return;
  }

  const targets = await chooseTargets(selectable, requested, opts);
  const linkNames = await chooseLinkNames(opts);
  const selections = buildSelections(targets, effective, linkNames);

  const mode = opts.copy ? "copy" : "symlink";
  const plan = planLinks(selections, materialized.cacheDir, cwd, { mode });

  if (opts.dryRun) {
    printPlan(plan);
    reporter.info("dry run — nothing was changed");
    return;
  }

  const executed = await executeLinks(plan, {
    copy: opts.copy,
    resolveConflict: buildConflictResolver(opts),
  });

  // Build lock entries from what actually happened, then merge + write.
  const newEntries = buildLockEntries(executed, selections, resolved, materialized, tag);
  const existing = await readLock(cwd);
  const lock = mergeEntries(existing, newEntries);
  await writeLock(cwd, lock);

  printSummary(executed, Object.keys(lock.contexts).length);
}

/**
 * Construct lock entries from executed ops. One entry per target, listing the
 * link names we actually own (created/replaced/already-ours), with the real
 * link mode and the content hash of the cached file.
 */
function buildLockEntries(
  executed: ExecutedOp[],
  selections: LinkSelection[],
  resolved: ResolvedSource,
  materialized: { cacheDir: string; resolvedRef: string | null },
  tag: string | null,
): Record<string, LockEntry> {
  const contextPathByTarget = new Map(selections.map((s) => [s.target, s.contextPath]));
  const entries: Record<string, LockEntry> = {};

  const byTarget = new Map<string, ExecutedOp[]>();
  for (const op of executed) {
    if (!owned(op)) continue;
    const list = byTarget.get(op.target) ?? [];
    list.push(op);
    byTarget.set(op.target, list);
  }

  for (const [target, ops] of byTarget) {
    const contextPath = contextPathByTarget.get(target);
    if (!contextPath) continue;
    const linkedAs = [...new Set(ops.map((op) => op.linkName))];
    const linkMode = ops.some((op) => op.mode === "copy") ? "copy" : "symlink";
    entries[target] = {
      source: resolved.source,
      sourceType: resolved.sourceType,
      resolvedRef: materialized.resolvedRef,
      ...(resolved.subpath ? { subpath: resolved.subpath } : {}),
      ...(tag ? { tag } : {}),
      contextPath,
      linkedAs: linkedAs as [string, ...string[]],
      linkMode,
      computedHash: hashFile(path.join(materialized.cacheDir, contextPath)),
    };
  }
  return entries;
}

function owned(op: ExecutedOp): boolean {
  return op.action === "skip-ok" || op.result === "created" || op.result === "replaced";
}

/** Decide which targets to link from flags, prompts, or non-interactive default. */
async function chooseTargets(
  selectable: MappingDiagnostic[],
  requested: RequestedTargets | null,
  opts: AddOptions,
): Promise<string[]> {
  if (requested) return selectable.map((d) => d.target);
  if (isInteractive(opts)) return selectMappings(selectable);
  return selectable.map((d) => d.target); // -y / non-interactive default = all
}

/** Decide link filenames from --link-as, prompt, or the default AGENTS.md. */
async function chooseLinkNames(opts: AddOptions): Promise<string[]> {
  if (opts.linkAs && opts.linkAs.length > 0) {
    for (const n of opts.linkAs) {
      if (!isValidLinkName(n)) {
        throw new CliError(
          ExitCode.Usage,
          `invalid --link-as value "${n}"`,
          "use a *.md filename or a dotfile name like .cursorrules",
        );
      }
    }
    return [...new Set(opts.linkAs)];
  }
  if (isInteractive(opts)) return selectLinkNames();
  return [DEFAULT_LINK_NAME];
}

function buildSelections(
  targets: string[],
  mappings: ManifestMapping[],
  linkNames: string[],
): LinkSelection[] {
  const byTarget = new Map(mappings.map((m) => [m.target, m]));
  return targets.map((target) => {
    const mapping = byTarget.get(target);
    if (!mapping) {
      throw new CliError(ExitCode.Usage, `no mapping for target "${target}"`);
    }
    return { target, contextPath: mapping.contextPath, linkNames };
  });
}

/** Build the conflict-resolution policy from flags + interactivity. */
function buildConflictResolver(
  opts: AddOptions,
): (op: LinkOperation) => ConflictChoice | Promise<ConflictChoice> {
  if (opts.force) return () => "backup";
  if (isInteractive(opts)) return resolveConflictPrompt;
  return () => "skip";
}

function printPlan(plan: LinkOperation[]): void {
  if (reporter.isJsonMode()) {
    reporter.json({ command: "add", dryRun: true, plan });
    return;
  }
  reporter.table(
    ["target", "link", "action", "mode"],
    plan.map((op) => [op.target, op.linkName, op.action, op.mode]),
  );
}

function printSummary(executed: ExecutedOp[], lockEntryCount: number): void {
  const counts = { created: 0, replaced: 0, skipped: 0, copied: 0 };
  for (const op of executed) {
    if (op.fellBack) counts.copied++;
    else counts[op.result]++;
  }
  if (reporter.isJsonMode()) {
    reporter.json({
      command: "add",
      counts,
      lockEntries: lockEntryCount,
      links: executed.map((op) => ({
        target: op.target,
        linkName: op.linkName,
        mode: op.mode,
        result: op.result,
      })),
      status: "linked",
    });
    return;
  }
  reporter.table(
    ["target", "link", "mode", "result"],
    executed.map((op) => [op.target, op.linkName, op.mode, op.result]),
  );
  reporter.info(`contexts.lock updated (${lockEntryCount} entries)`);
  reporter.outro(
    `${counts.created} created, ${counts.replaced} replaced, ${counts.copied} copied, ${counts.skipped} skipped`,
  );
}

interface RequestedTargets {
  all: boolean;
  values: string[];
}

function normalizeRequestedTargets(targets: string[] | undefined): RequestedTargets | null {
  if (!targets || targets.length === 0) return null;
  if (targets.includes("*")) return { all: true, values: [] };
  return { all: false, values: targets.map((t) => t.replace(/^\.\//, "").replace(/\/+$/, "")) };
}

function assertKnownTargets(values: string[], diagnostics: MappingDiagnostic[]): void {
  const known = new Set(diagnostics.map((d) => d.target));
  const unknown = values.filter((v) => !known.has(v));
  if (unknown.length > 0) {
    throw new CliError(
      ExitCode.Usage,
      `unknown --target ${unknown.map((u) => `"${u}"`).join(", ")}`,
      `available targets: ${[...known].join(", ") || "(none)"}`,
    );
  }
}

function computeSelectable(
  diagnostics: MappingDiagnostic[],
  requested: RequestedTargets | null,
  includeDrifted: boolean,
): MappingDiagnostic[] {
  return diagnostics.filter((d) => {
    if (requested && !requested.all && !requested.values.includes(d.target)) return false;
    if (d.state === "drifted" && !includeDrifted) return false;
    return true;
  });
}
