/**
 * Cache service: materialize any resolved source into
 * `.contexts/cache/<slug>/` with a `.contexts-meta.json` sidecar.
 *
 * The cache is the stable local target that symlinks point at. Materialization
 * builds into a temp sibling then atomically swaps it into place, so the cache
 * is never left half-written.
 *
 * @see docs/02-architecture.md §pillar 1, docs/05-source-resolution.md
 */
import { createHash, randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import type { ResolvedSource } from "../types.js";
import { CliError, ExitCode } from "../utils/errors.js";
import { atomicWrite, ensureDir } from "../utils/fs.js";
import { clone, revParse } from "./git.js";
import { directoryDigest } from "./hash.js";

const MANIFEST_FILE = "contexts.yml";
const META_FILE = ".contexts-meta.json";
const COPY_EXCLUDE = new Set([".git", "node_modules"]);

export interface MaterializeResult {
  cacheDir: string;
  resolvedRef: string | null;
  directoryDigest: string | null;
}

export interface MetaSidecar {
  source: string;
  sourceType: ResolvedSource["sourceType"];
  resolvedRef: string | null;
  directoryDigest: string | null;
  fetchedAt: string;
}

/** Deterministic, filesystem-safe slug for a source (docs/05 §Cache slugging). */
export function slugForSource(resolved: ResolvedSource): string {
  const sanitize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  if (resolved.sourceType === "github") {
    const [org, repo] = resolved.source.split("/");
    const sub = resolved.subpath ? `-${sanitize(resolved.subpath)}` : "";
    return `github-${sanitize(org ?? "")}-${sanitize(repo ?? "")}${sub}`;
  }
  const digest = createHash("sha256").update(resolved.source).digest("hex").slice(0, 12);
  return `${resolved.sourceType}-${digest}`;
}

export class CacheService {
  readonly cacheRoot: string;

  constructor(readonly projectRoot: string) {
    this.cacheRoot = path.join(projectRoot, ".contexts", "cache");
  }

  /** Absolute cache dir for a source (may not exist yet). */
  cacheDirFor(resolved: ResolvedSource): string {
    return path.join(this.cacheRoot, slugForSource(resolved));
  }

  /** Now as an ISO-8601 string. Isolated so tests can stub it. */
  protected now(): string {
    return new Date().toISOString();
  }

  /**
   * Materialize a source into its cache dir, writing the meta sidecar. For
   * github/git, `pinnedRef` (an exact SHA from a lock) overrides the resolved
   * source's requestedRef so `install` reproduces the pinned state.
   */
  async materialize(
    resolved: ResolvedSource,
    opts: { pinnedRef?: string | null } = {},
  ): Promise<MaterializeResult> {
    ensureDir(this.cacheRoot);
    const finalDir = this.cacheDirFor(resolved);
    const staging = `${finalDir}.${randomBytes(6).toString("hex")}.stage`;

    let resolvedRef: string | null = null;
    let digest: string | null = null;

    try {
      if (resolved.sourceType === "local") {
        ({ resolvedRef, digest } = this.materializeLocal(resolved, staging));
      } else {
        ({ resolvedRef } = await this.materializeRemote(resolved, staging, opts.pinnedRef ?? null));
      }

      this.assertManifestPresent(staging, resolved);
      this.writeMeta(staging, {
        source: resolved.source,
        sourceType: resolved.sourceType,
        resolvedRef,
        directoryDigest: digest,
        fetchedAt: this.now(),
      });

      // Atomic swap into place.
      if (existsSync(finalDir)) rmSync(finalDir, { recursive: true, force: true });
      renameSync(staging, finalDir);
    } finally {
      if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
    }

    return { cacheDir: finalDir, resolvedRef, directoryDigest: digest };
  }

  private materializeLocal(
    resolved: ResolvedSource,
    staging: string,
  ): { resolvedRef: null; digest: string } {
    const src = resolved.localPath as string;
    if (!existsSync(src) || !statSync(src).isDirectory()) {
      throw new CliError(
        ExitCode.Usage,
        `local source "${src}" is not a directory`,
        "pass a path to a contexts repository directory",
      );
    }
    if (!existsSync(path.join(src, MANIFEST_FILE))) {
      throw missingManifestError(resolved);
    }
    copyTree(src, staging);
    return {
      resolvedRef: null,
      digest: directoryDigest(staging, { exclude: [".git", "node_modules"] }),
    };
  }

  private async materializeRemote(
    resolved: ResolvedSource,
    staging: string,
    pinnedRef: string | null,
  ): Promise<{ resolvedRef: string }> {
    const cloneTmp = mkdtempSync(`${this.cacheRoot}${path.sep}clone-`);
    try {
      await clone({
        url: resolved.fetchUrl as string,
        dir: cloneTmp,
        ref: pinnedRef ?? resolved.requestedRef,
      });
      const resolvedRef = await revParse(cloneTmp);

      let srcRoot = cloneTmp;
      if (resolved.subpath) {
        srcRoot = path.join(cloneTmp, resolved.subpath);
        if (!existsSync(srcRoot) || !statSync(srcRoot).isDirectory()) {
          throw new CliError(
            ExitCode.Usage,
            `no ${MANIFEST_FILE} at ${resolved.subpath} in ${resolved.source}`,
            "check the subpath in the /tree/<ref>/<subpath> URL",
          );
        }
      }
      copyTree(srcRoot, staging);
      return { resolvedRef };
    } finally {
      rmSync(cloneTmp, { recursive: true, force: true });
    }
  }

  private assertManifestPresent(stagingDir: string, resolved: ResolvedSource): void {
    if (!existsSync(path.join(stagingDir, MANIFEST_FILE))) {
      if (resolved.subpath) {
        throw new CliError(
          ExitCode.Usage,
          `no ${MANIFEST_FILE} at ${resolved.subpath} in ${resolved.source}`,
          "check the subpath in the /tree/<ref>/<subpath> URL",
        );
      }
      throw missingManifestError(resolved);
    }
  }

  private writeMeta(dir: string, meta: MetaSidecar): void {
    atomicWrite(path.join(dir, META_FILE), `${JSON.stringify(meta, null, 2)}\n`);
  }
}

function missingManifestError(resolved: ResolvedSource): CliError {
  return new CliError(
    ExitCode.Usage,
    `${resolved.source} doesn't look like a contexts repository — expected ${MANIFEST_FILE} at the root`,
    "pass a /tree/<ref>/<subpath> URL if the manifest lives in a subdirectory",
  );
}

/** Recursively copy a directory tree, excluding `.git/` and `node_modules/`. */
function copyTree(src: string, dest: string): void {
  ensureDir(path.dirname(dest));
  cpSync(src, dest, {
    recursive: true,
    dereference: false,
    filter: (source) => {
      const base = path.basename(source);
      return !COPY_EXCLUDE.has(base);
    },
  });
}
