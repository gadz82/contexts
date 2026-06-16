/**
 * Shared interfaces used across core/command/ui layers.
 *
 * Schemas that have a runtime contract (manifest, lockfile) live with their
 * zod definitions in `core/`; this file holds the structural types that are
 * pure compile-time shapes.
 *
 * @see docs/05-source-resolution.md, docs/06-linking-engine.md, docs/04-data-formats.md
 */

/** How a source string was classified by the resolver (docs/05). */
export type SourceType = "github" | "git" | "local";

/** Result of parsing a user source string (docs/05). */
export interface ResolvedSource {
  /** What the user typed. */
  raw: string;
  /** Canonical form stored in the lock. */
  source: string;
  sourceType: SourceType;
  /** https clone URL for github, URL for git, null for local. */
  fetchUrl: string | null;
  /** From `#ref` or `/tree/<ref>`; null = default branch. */
  requestedRef: string | null;
  /** contexts root inside the repo (subpath); null = repo root. */
  subpath: string | null;
  /** Absolute path for local sources; null otherwise. */
  localPath: string | null;
}

/** What was actually created at a link path. */
export type LinkMode = "symlink" | "copy";

/** A single planned link operation (docs/06 §Plan). */
export interface LinkOperation {
  /** Normalized target dir, POSIX, e.g. "src/api" or ".". */
  target: string;
  /** Link filename, e.g. "AGENTS.md". */
  linkName: string;
  /** Absolute path of the link to create. */
  linkPath: string;
  /** Absolute path of the cached canonical file. */
  cachedFile: string;
  /** Relative link value: path.relative(dirname(linkPath), cachedFile). */
  relTarget: string;
  action: "create" | "replace-link" | "conflict" | "skip-ok";
  mode: LinkMode;
}

/** The outcome of executing a {@link LinkOperation}. */
export interface ExecutedOp extends LinkOperation {
  /** Final result after execution. */
  result: "created" | "replaced" | "skipped" | "copied";
  /** Backup path written when a conflicting file was replaced. */
  backupPath?: string;
  /** True when a symlink was requested but a copy fallback was used. */
  fellBack?: boolean;
}

/** A mapping evaluated against the consumer project tree (docs/01 glossary). */
export interface MappingDiagnostic {
  target: string;
  contextSource: string;
  description?: string;
  state: "valid" | "drifted";
}

/** A concrete selection feeding the linker (one target → many link names). */
export interface LinkSelection {
  /** Normalized target dir. */
  target: string;
  /** POSIX path of the source file inside the cache, relative to cacheDir. */
  contextPath: string;
  /** Link filenames to create. */
  linkNames: string[];
}
