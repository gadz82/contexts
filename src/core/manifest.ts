/**
 * contexts.yml manifest: zod schema, strict loader, and drift diagnostics.
 *
 * The manifest is a discovery/UX artifact used only by `add` — never at
 * install time (the lock is self-contained). Validation is strict: every bad
 * shape produces a distinct `CliError(2)` quoting the offending key/path.
 *
 * @see docs/04-data-formats.md §contexts.yml
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { YAMLParseError, parse as parseYaml } from "yaml";
import { z } from "zod";
import type { MappingDiagnostic } from "../types.js";
import { CliError, ExitCode } from "../utils/errors.js";
import { posixify } from "../utils/fs.js";

const MANIFEST_FILE = "contexts.yml";

const RawMappingSchema = z.object({
  context_source: z.string().min(1),
  description: z.string().max(200).optional(),
});

const RawTagSchema = z.object({
  mappings: z.record(z.string(), RawMappingSchema),
});

const RawManifestSchema = z.object({
  version: z.string(),
  name: z.string().optional(),
  description: z.string().max(200).optional(),
  mappings: z.record(z.string(), RawMappingSchema),
  tags: z.record(z.string(), RawTagSchema).optional(),
});

export interface ManifestMapping {
  /** Normalized POSIX target path (e.g. "src/api" or "."). */
  target: string;
  /** POSIX path of the source file inside the cache, relative to cacheDir. */
  contextPath: string;
  description?: string;
}

export interface Manifest {
  version: string;
  name?: string;
  description?: string;
  /** Root (default) mappings. */
  mappings: ManifestMapping[];
  /** Named tags; each set of mappings overrides/extends the root by target. */
  tags: Record<string, ManifestMapping[]>;
}

/** Load + strictly validate the manifest from a materialized cache dir. */
export function loadManifest(cacheDir: string): Manifest {
  const manifestPath = path.join(cacheDir, MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    throw new CliError(
      ExitCode.Usage,
      `no ${MANIFEST_FILE} found in the source`,
      "the source must contain contexts.yml at its root",
    );
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    if (err instanceof YAMLParseError) {
      throw new CliError(
        ExitCode.Usage,
        `${MANIFEST_FILE} is not valid YAML: ${err.message}`,
        "fix the YAML syntax",
      );
    }
    throw err;
  }

  const result = RawManifestSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.length ? ` at "${issue.path.join(".")}"` : "";
    throw new CliError(
      ExitCode.Usage,
      `invalid ${MANIFEST_FILE}${where}: ${issue?.message ?? "schema error"}`,
      "see docs/04-data-formats.md §contexts.yml",
    );
  }
  const raw = result.data;

  if (raw.version !== "1") {
    throw new CliError(
      ExitCode.Usage,
      `unsupported ${MANIFEST_FILE} version "${raw.version}" (expected "1")`,
      "upgrade contexts to a version that supports this manifest",
    );
  }

  if (Object.keys(raw.mappings).length === 0) {
    throw new CliError(
      ExitCode.Usage,
      `${MANIFEST_FILE} has no mappings`,
      "add at least one target → context_source mapping",
    );
  }

  const mappings = parseMappings(cacheDir, raw.mappings, "mappings");

  const tags: Record<string, ManifestMapping[]> = {};
  for (const [tagName, tag] of Object.entries(raw.tags ?? {})) {
    if (tagName === "default") {
      throw new CliError(
        ExitCode.Usage,
        `tag "default" is reserved`,
        "`--tag default` rolls back to the root mappings; rename this tag",
      );
    }
    if (Object.keys(tag.mappings).length === 0) {
      throw new CliError(
        ExitCode.Usage,
        `tag "${tagName}" has no mappings`,
        "a tag must override or add at least one mapping, or remove it",
      );
    }
    tags[tagName] = parseMappings(cacheDir, tag.mappings, `tags.${tagName}.mappings`);
  }

  return { version: raw.version, name: raw.name, description: raw.description, mappings, tags };
}

/** Validate + resolve a `mappings` record into normalized {@link ManifestMapping}s. */
function parseMappings(
  cacheDir: string,
  rawMappings: Record<string, { context_source: string; description?: string }>,
  where: string,
): ManifestMapping[] {
  // Pass 1: normalize keys + detect duplicates (independent of file checks).
  const seen = new Map<string, string>();
  const normalized = Object.entries(rawMappings).map(([rawKey, value]) => {
    const target = normalizeTarget(rawKey);
    const prevKey = seen.get(target);
    if (prevKey !== undefined) {
      throw new CliError(
        ExitCode.Usage,
        `duplicate mapping target "${target}" in ${where} (from "${prevKey}" and "${rawKey}")`,
        "each target path may appear only once after normalization",
      );
    }
    seen.set(target, rawKey);
    return { rawKey, target, value };
  });

  // Pass 2: validate + resolve each context_source against the cache.
  return normalized.map(({ rawKey, target, value }) => ({
    target,
    contextPath: resolveContextSource(cacheDir, rawKey, value.context_source),
    description: value.description,
  }));
}

/**
 * The effective mappings for an optional tag: root mappings, with the tag's
 * mappings layered on top (overriding matching targets, adding new ones).
 * Returns the root set when `tag` is null/undefined.
 *
 * Throws `CliError(2)` if `tag` is given but not defined in the manifest.
 */
export function resolveMappings(manifest: Manifest, tag?: string | null): ManifestMapping[] {
  if (!tag) return manifest.mappings;
  const overrides = manifest.tags[tag];
  if (!overrides) {
    const available = Object.keys(manifest.tags);
    throw new CliError(
      ExitCode.Usage,
      `unknown tag "${tag}"`,
      available.length
        ? `available tags: ${available.join(", ")}`
        : "this manifest defines no tags",
    );
  }
  const byTarget = new Map(manifest.mappings.map((m) => [m.target, m]));
  for (const m of overrides) byTarget.set(m.target, m);
  return [...byTarget.values()];
}

/** Evaluate each mapping against the consumer project's real directory tree. */
export function diagnose(
  manifest: Manifest,
  projectRoot: string,
  tag?: string | null,
): MappingDiagnostic[] {
  return resolveMappings(manifest, tag).map((m) => {
    const targetDir = m.target === "." ? projectRoot : path.join(projectRoot, m.target);
    const valid = existsSync(targetDir) && statSync(targetDir).isDirectory();
    return {
      target: m.target,
      contextSource: m.contextPath,
      description: m.description,
      state: valid ? "valid" : "drifted",
    };
  });
}

function normalizeTarget(key: string): string {
  let k = key.trim().replace(/\\/g, "/");
  if (k === "") {
    throw new CliError(
      ExitCode.Usage,
      "empty mapping target key",
      "mapping keys must be relative paths",
    );
  }
  if (k.startsWith("/") || /^[A-Za-z]:/.test(k)) {
    throw new CliError(
      ExitCode.Usage,
      `mapping target "${key}" is absolute`,
      "mapping keys must be relative POSIX paths inside the project",
    );
  }
  k = k.replace(/^\.\//, "").replace(/\/+$/, "");
  if (k === "" || k === ".") return ".";
  const segments = k.split("/");
  if (segments.includes("..")) {
    throw new CliError(
      ExitCode.Usage,
      `mapping target "${key}" escapes the project root with ".."`,
      "mapping keys may not contain '..'",
    );
  }
  return segments.join("/");
}

function resolveContextSource(cacheDir: string, targetKey: string, contextSource: string): string {
  const raw = contextSource.trim().replace(/\\/g, "/");
  if (raw.startsWith("/") || /^[A-Za-z]:/.test(raw)) {
    throw new CliError(
      ExitCode.Usage,
      `context_source "${contextSource}" for "${targetKey}" is absolute`,
      "context_source must be relative to the contexts repo root",
    );
  }
  const rel = raw.replace(/^\.\//, "");
  const abs = path.resolve(cacheDir, rel);
  // Path-traversal guard: the resolved file must stay inside the cache dir.
  const prefix = cacheDir.endsWith(path.sep) ? cacheDir : cacheDir + path.sep;
  if (!abs.startsWith(prefix)) {
    throw new CliError(
      ExitCode.Usage,
      `context_source "${contextSource}" for "${targetKey}" escapes the contexts repo`,
      "context_source may not contain '..' or point outside the repo",
    );
  }
  if (!existsSync(abs)) {
    throw new CliError(
      ExitCode.Usage,
      `context_source "${contextSource}" for "${targetKey}" does not exist in the source`,
      "check the path in contexts.yml",
    );
  }
  if (!statSync(abs).isFile()) {
    throw new CliError(
      ExitCode.Usage,
      `context_source "${contextSource}" for "${targetKey}" is not a regular file`,
      "context_source must point at a file",
    );
  }
  return posixify(path.relative(cacheDir, abs));
}
