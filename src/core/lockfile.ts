/**
 * `contexts.lock` — the self-contained, deterministic restore record.
 *
 * `install` reads only this file (never contexts.yml). It is written atomically
 * with recursively-sorted keys and a trailing newline so diffs stay clean.
 *
 * @see docs/04-data-formats.md §contexts.lock
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CliError, ExitCode } from "../utils/errors.js";
import { atomicWrite, exists } from "../utils/fs.js";
import { isValidLinkName } from "../utils/linkname.js";

export const LOCK_FILE = "contexts.lock";
export const LOCK_VERSION = 1;

const SHA256_RE = /^[0-9a-f]{64}$/;

const LockEntrySchema = z.object({
  source: z.string().min(1),
  sourceType: z.enum(["github", "git", "local"]),
  resolvedRef: z.string().nullable(),
  /** Contexts root inside the repo (from a /tree/<ref>/<subpath> URL). */
  subpath: z.string().min(1).optional(),
  /** Active tag (context variant) this entry was resolved under, if any. */
  tag: z.string().min(1).optional(),
  contextPath: z.string().min(1),
  linkedAs: z
    .array(z.string())
    .nonempty()
    .refine((names) => new Set(names).size === names.length && names.every(isValidLinkName), {
      message: "linkedAs must be unique valid link names",
    }),
  linkMode: z.enum(["symlink", "copy"]),
  computedHash: z.string().regex(SHA256_RE, "computedHash must be lowercase hex sha256"),
});

const LockFileSchema = z.object({
  version: z.number().int(),
  contexts: z.record(z.string(), LockEntrySchema),
});

export type LockEntry = z.infer<typeof LockEntrySchema>;
export type LockFile = z.infer<typeof LockFileSchema>;

/** Read + validate the lock. Returns null if absent; throws exit 4 otherwise. */
export async function readLock(projectRoot: string): Promise<LockFile | null> {
  const lockPath = path.join(projectRoot, LOCK_FILE);
  if (!(await exists(lockPath))) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(lockPath, "utf8"));
  } catch {
    throw new CliError(
      ExitCode.Lock,
      `${LOCK_FILE} is not valid JSON`,
      "fix or delete it, then run `contexts install` or `contexts add`",
    );
  }

  // Version guard before full validation so the "upgrade" message is precise.
  const version = (parsed as { version?: unknown })?.version;
  if (typeof version === "number" && version > LOCK_VERSION) {
    throw new CliError(
      ExitCode.Lock,
      `${LOCK_FILE} is version ${version}, newer than this CLI supports (${LOCK_VERSION})`,
      "upgrade contexts to a newer version",
    );
  }

  const result = LockFileSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.length ? ` at "${issue.path.join(".")}"` : "";
    throw new CliError(
      ExitCode.Lock,
      `invalid ${LOCK_FILE}${where}: ${issue?.message ?? "schema error"}`,
      "fix or delete it, then re-run",
    );
  }
  return result.data;
}

/** Write the lock atomically with recursively-sorted keys + trailing newline. */
export async function writeLock(projectRoot: string, lock: LockFile): Promise<void> {
  const lockPath = path.join(projectRoot, LOCK_FILE);
  atomicWrite(lockPath, `${stableStringify(lock)}\n`);
}

/**
 * Merge new entries into existing ones, keyed by target path. Re-adding a source
 * reconciles (replaces same-target entries); entries for other targets/sources
 * are preserved. Never duplicates a target.
 */
export function mergeEntries(
  existing: LockFile | null,
  newEntries: Record<string, LockEntry>,
): LockFile {
  const contexts = { ...(existing?.contexts ?? {}), ...newEntries };
  return { version: LOCK_VERSION, contexts };
}

/** Deterministic JSON with recursively-sorted object keys, 2-space indent. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}
