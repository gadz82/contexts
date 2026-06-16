/**
 * Thin wrapper over git via `child_process.spawn` (never a shell string).
 *
 * Subcommands used: `clone --depth 1`, `rev-parse`, `ls-remote`, `checkout`.
 * Network operations time out after 120 s and kill the whole process group.
 * Failures surface git's stderr tail wrapped in a {@link GitError} (exit 3).
 *
 * @see docs/05-source-resolution.md §Fetch strategies
 */
import { spawn, spawnSync } from "node:child_process";
import * as reporter from "../ui/reporter.js";
import { CliError, ExitCode } from "../utils/errors.js";

const DEFAULT_TIMEOUT_MS = 120_000;

/** A source-fetch failure (exit 3). */
export class GitError extends CliError {
  constructor(message: string, hint?: string) {
    super(ExitCode.Fetch, message, hint);
    this.name = "GitError";
  }
}

let gitAvailable: boolean | undefined;

/** Verify a usable `git` is on PATH. Cached per process. */
export function assertGitAvailable(): void {
  if (gitAvailable === true) return;
  if (gitAvailable === undefined) {
    const res = spawnSync("git", ["--version"], { encoding: "utf8" });
    gitAvailable = res.status === 0 && !res.error;
  }
  if (!gitAvailable) {
    throw new GitError(
      "git is required but was not found on PATH",
      "install git from https://git-scm.com and re-run",
    );
  }
}

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a git subcommand. Resolves with the captured streams; never rejects on a
 * non-zero exit (callers decide how to treat that). Rejects only on timeout.
 */
function runGit(
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<RunResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  reporter.debug(`$ git ${args.join(" ")}`);
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: opts.cwd,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        // already gone
      }
    }, timeoutMs);

    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new GitError(`failed to run git: ${err.message}`, "is git installed and on PATH?"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(
          new GitError(
            `git ${args[0]} timed out after ${Math.round(timeoutMs / 1000)}s`,
            "check the network/remote and retry",
          ),
        );
        return;
      }
      if ((code ?? 1) !== 0 && stderr.trim()) reporter.debug(stderr.trim());
      resolve({ status: code ?? 1, stdout, stderr });
    });
  });
}

function stderrTail(stderr: string, lines = 4): string {
  return stderr.trim().split("\n").slice(-lines).join("\n");
}

export interface CloneOptions {
  /** Clone URL. */
  url: string;
  /** Destination directory (must not yet exist or be empty). */
  dir: string;
  /** Branch, tag, or commit SHA to fetch; null = default branch. */
  ref?: string | null;
  timeoutMs?: number;
}

const SHA_RE = /^[0-9a-f]{7,40}$/i;

/**
 * Clone `url` into `dir` at the requested ref. Tries a shallow branch/tag clone
 * first; falls back to a full clone + `checkout` when the ref is a SHA (not
 * shallow-clonable by name).
 */
export async function clone(opts: CloneOptions): Promise<void> {
  assertGitAvailable();
  const { url, dir, ref } = opts;
  const timeoutMs = opts.timeoutMs;

  if (ref) {
    const shallow = await runGit(["clone", "--depth", "1", "--branch", ref, url, dir], {
      timeoutMs,
    });
    if (shallow.status === 0) return;
    // Branch/tag shallow clone failed — likely a raw SHA. Full clone + checkout.
    const full = await runGit(["clone", url, dir], { timeoutMs });
    if (full.status !== 0) {
      throw cloneFailed(url, full.stderr);
    }
    const checkout = await runGit(["-C", dir, "checkout", ref], { timeoutMs });
    if (checkout.status !== 0) {
      throw new GitError(
        `could not check out ref "${ref}" in ${url}`,
        `verify the branch/tag/commit exists:\n${stderrTail(checkout.stderr)}`,
      );
    }
    return;
  }

  const res = await runGit(["clone", "--depth", "1", url, dir], { timeoutMs });
  if (res.status !== 0) {
    throw cloneFailed(url, res.stderr);
  }
}

function cloneFailed(url: string, stderr: string): GitError {
  return new GitError(
    `failed to clone ${url}`,
    `${stderrTail(stderr)}\ncheck the URL, your access (ssh/credential helper), and the ref`,
  );
}

/** Resolve `HEAD` (or any ref) to a full commit SHA inside a clone. */
export async function revParse(dir: string, ref = "HEAD"): Promise<string> {
  const res = await runGit(["-C", dir, "rev-parse", ref]);
  if (res.status !== 0) {
    throw new GitError(`could not resolve ${ref} in ${dir}`, stderrTail(res.stderr));
  }
  return res.stdout.trim();
}

/**
 * `git ls-remote` for upstream HEAD inspection (used by `update`/`status`).
 * Returns the resolved SHA for the given ref (default HEAD).
 */
export async function lsRemote(url: string, ref = "HEAD"): Promise<string> {
  assertGitAvailable();
  const res = await runGit(["ls-remote", url, ref]);
  if (res.status !== 0) {
    throw new GitError(`failed to query ${url}`, stderrTail(res.stderr));
  }
  const first = res.stdout.trim().split("\n")[0] ?? "";
  const sha = first.split(/\s+/)[0] ?? "";
  if (!SHA_RE.test(sha)) {
    throw new GitError(`no ref "${ref}" at ${url}`, "check the ref name");
  }
  return sha;
}

/** Test-only: reset the cached availability probe. */
export function _resetGitProbe(): void {
  gitAvailable = undefined;
}
