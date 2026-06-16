/**
 * Source string resolution: turn what the user typed into a {@link ResolvedSource}.
 *
 * Accepts GitHub shorthand, full GitHub/GitLab/generic https URLs, SSH git
 * URLs, and local paths, plus an optional `#ref` pin. The `#ref` split happens
 * before all other parsing.
 *
 * @see docs/05-source-resolution.md
 */
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { ResolvedSource } from "../types.js";
import * as reporter from "../ui/reporter.js";
import { CliError, ExitCode } from "../utils/errors.js";

const SHORTHAND_RE = /^[\w.-]+\/[\w.-]+$/;

/** Parse a raw source string against a working directory. */
export function parseSource(raw: string, cwd: string): ResolvedSource {
  const trimmed = raw.trim();
  if (trimmed === "") {
    throw new CliError(ExitCode.Usage, "empty source", "pass a contexts repo, URL, or local path");
  }

  // `#ref` split happens before everything else.
  const hashIdx = trimmed.indexOf("#");
  const base = hashIdx >= 0 ? trimmed.slice(0, hashIdx) : trimmed;
  const refFromHash = hashIdx >= 0 ? trimmed.slice(hashIdx + 1) : null;
  if (refFromHash !== null && refFromHash.trim() === "") {
    throw new CliError(ExitCode.Usage, `empty ref in "${raw}"`, "use source#<branch|tag|sha>");
  }

  // 1. Explicit local prefixes always win.
  if (isExplicitLocalPath(base)) {
    return resolveLocal(raw, base, cwd, refFromHash);
  }

  // 2. SSH / file / generic git URLs.
  if (base.startsWith("git@") || base.startsWith("ssh://") || base.startsWith("file://")) {
    return {
      raw,
      source: base,
      sourceType: "git",
      fetchUrl: base,
      requestedRef: refFromHash,
      subpath: null,
      localPath: null,
    };
  }

  // 3. http(s) URLs.
  if (/^https?:\/\//.test(base)) {
    return resolveHttpUrl(raw, base, refFromHash);
  }

  // 4. Shorthand org/repo — unless it also exists on disk (local wins).
  if (SHORTHAND_RE.test(base)) {
    if (existsAsDir(path.resolve(cwd, base))) {
      reporter.warn(
        `"${base}" interpreting as local path; use the full GitHub URL to force remote`,
      );
      return resolveLocal(raw, base, cwd, refFromHash);
    }
    const [org, repo] = base.split("/");
    return {
      raw,
      source: `${org}/${repo}`,
      sourceType: "github",
      fetchUrl: `https://github.com/${org}/${repo}.git`,
      requestedRef: refFromHash,
      subpath: null,
      localPath: null,
    };
  }

  // 5. Last resort: a bare path that exists on disk is local.
  if (existsAsDir(path.resolve(cwd, base))) {
    return resolveLocal(raw, base, cwd, refFromHash);
  }

  throw new CliError(
    ExitCode.Usage,
    `could not interpret source "${raw}"`,
    "use org/repo, an https/git URL, or a local path containing contexts.yml",
  );
}

function isExplicitLocalPath(base: string): boolean {
  return (
    base.startsWith("/") ||
    base.startsWith("./") ||
    base.startsWith("../") ||
    base === "." ||
    base === ".." ||
    base.startsWith("~") ||
    /^[A-Za-z]:[\\/]/.test(base) // Windows drive path
  );
}

function existsAsDir(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function resolveLocal(
  raw: string,
  base: string,
  cwd: string,
  refFromHash: string | null,
): ResolvedSource {
  if (refFromHash !== null) {
    throw new CliError(
      ExitCode.Usage,
      "a #ref pin is not applicable to local sources",
      "local sources always use their current on-disk content; drop the #ref",
    );
  }
  const abs = path.resolve(cwd, base);
  return {
    raw,
    source: abs,
    sourceType: "local",
    fetchUrl: null,
    requestedRef: null,
    subpath: null,
    localPath: abs,
  };
}

function resolveHttpUrl(raw: string, base: string, refFromHash: string | null): ResolvedSource {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new CliError(ExitCode.Usage, `invalid URL "${base}"`, "check the source URL");
  }

  if (url.hostname === "github.com" || url.hostname === "www.github.com") {
    const segments = url.pathname.split("/").filter(Boolean);
    const [org, repoRaw, treeKeyword, ...rest] = segments;
    if (!org || !repoRaw) {
      throw new CliError(
        ExitCode.Usage,
        `GitHub URL "${base}" is missing org/repo`,
        "expected https://github.com/<org>/<repo>",
      );
    }
    const repo = repoRaw.replace(/\.git$/, "");
    let requestedRef = refFromHash;
    let subpath: string | null = null;
    if (treeKeyword === "tree" && rest.length > 0) {
      // /tree/<ref>[/<subpath>] — ref is the first segment, the rest is subpath.
      requestedRef = refFromHash ?? (rest[0] as string);
      const sub = rest.slice(1).join("/");
      subpath = sub.length > 0 ? sub : null;
    }
    return {
      raw,
      source: `${org}/${repo}`,
      sourceType: "github",
      fetchUrl: `https://github.com/${org}/${repo}.git`,
      requestedRef,
      subpath,
      localPath: null,
    };
  }

  // Any other https remote is a generic git source, cloned as-is.
  return {
    raw,
    source: base,
    sourceType: "git",
    fetchUrl: base,
    requestedRef: refFromHash,
    subpath: null,
    localPath: null,
  };
}
