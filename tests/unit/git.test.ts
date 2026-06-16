import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitError, assertGitAvailable, clone, lsRemote, revParse } from "../../src/core/git.js";
import { cleanup, initGitRepo, makeTmpDir } from "../helpers/tmp.js";

const FIXTURE = path.resolve(__dirname, "../fixtures/contexts-basic");

describe("git", () => {
  let repo: string;
  let head: string;
  beforeEach(() => {
    repo = makeTmpDir("gitrepo-");
    head = initGitRepo(repo, FIXTURE);
  });
  afterEach(() => cleanup(repo));

  it("assertGitAvailable does not throw when git is installed", () => {
    expect(() => assertGitAvailable()).not.toThrow();
  });

  it("clone + revParse resolves HEAD to the committed SHA", async () => {
    const dest = mkdtempSync(path.join(tmpdir(), "clone-"));
    await clone({ url: repo, dir: path.join(dest, "wt") });
    expect(await revParse(path.join(dest, "wt"))).toBe(head);
    cleanup(dest);
  });

  it("clone at a specific SHA falls back to full-clone + checkout", async () => {
    const dest = mkdtempSync(path.join(tmpdir(), "clonesha-"));
    await clone({ url: repo, dir: path.join(dest, "wt"), ref: head });
    expect(await revParse(path.join(dest, "wt"))).toBe(head);
    cleanup(dest);
  });

  it("lsRemote returns the upstream HEAD sha", async () => {
    expect(await lsRemote(repo)).toBe(head);
  });

  it("lsRemote on a bogus url throws GitError (exit 3)", async () => {
    await expect(lsRemote(path.join(repo, "does-not-exist"))).rejects.toBeInstanceOf(GitError);
    await expect(lsRemote(path.join(repo, "does-not-exist"))).rejects.toMatchObject({
      exitCode: 3,
    });
  });

  it("clone of a non-repo throws GitError (exit 3)", async () => {
    const dest = mkdtempSync(path.join(tmpdir(), "clonefail-"));
    await expect(
      clone({ url: path.join(repo, "nope"), dir: path.join(dest, "wt") }),
    ).rejects.toMatchObject({ exitCode: 3 });
    cleanup(dest);
  });

  it("revParse on a non-repo throws GitError", async () => {
    const empty = makeTmpDir("notrepo-");
    await expect(revParse(empty)).rejects.toBeInstanceOf(GitError);
    cleanup(empty);
  });
});
