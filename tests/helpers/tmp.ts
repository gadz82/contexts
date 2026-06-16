import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Create a disposable directory under the OS temp dir. */
export function makeTmpDir(prefix = "contexts-test-"): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

/** Remove a directory tree, ignoring errors. */
export function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" });
}

/**
 * Initialize a git repo at `dir` with `contents` copied in, commit, and return
 * the resolved HEAD SHA. Network-free stand-in for a remote source.
 */
export function initGitRepo(dir: string, contentsSrc: string, message = "init"): string {
  cpSync(contentsSrc, dir, { recursive: true });
  git(dir, ["init", "-q"]);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", message]);
  return git(dir, ["rev-parse", "HEAD"]).trim();
}

/** Add a file, commit, and return the new HEAD SHA. */
export function commitChange(
  dir: string,
  relPath: string,
  content: string,
  message = "change",
): string {
  writeFileSync(path.join(dir, relPath), content);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", message]);
  return git(dir, ["rev-parse", "HEAD"]).trim();
}

export { git };
