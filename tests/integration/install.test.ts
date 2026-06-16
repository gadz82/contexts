import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addCommand } from "../../src/commands/add.js";
import { installCommand } from "../../src/commands/install.js";
import { readLock } from "../../src/core/lockfile.js";
import { configureReporter } from "../../src/ui/reporter.js";
import { CliError } from "../../src/utils/errors.js";
import { cleanup, commitChange, initGitRepo, makeTmpDir } from "../helpers/tmp.js";

const FIXTURE = path.resolve(__dirname, "../fixtures/contexts-basic");

describe("install — integration", () => {
  let project: string;
  let repo: string;
  let prevCwd: string;
  let head: string;

  beforeEach(() => {
    prevCwd = process.cwd();
    project = makeTmpDir("instproj-");
    repo = makeTmpDir("instrepo-");
    head = initGitRepo(repo, FIXTURE);
    mkdirSync(path.join(project, "src", "api"), { recursive: true });
    mkdirSync(path.join(project, "src", "components"), { recursive: true });
    process.chdir(project);
    configureReporter({ json: false });
  });
  afterEach(() => {
    process.chdir(prevCwd);
    cleanup(project);
    cleanup(repo);
  });

  const gitSource = (ref?: string) => `file://${repo}${ref ? `#${ref}` : ""}`;

  it("add writes a lock matching the docs/04 contract", async () => {
    await addCommand(gitSource(), { target: ["*"], linkAs: ["AGENTS.md"], yes: true });
    const lock = await readLock(project);
    expect(lock?.version).toBe(1);
    const api = lock?.contexts["src/api"];
    expect(api?.sourceType).toBe("git");
    expect(api?.resolvedRef).toBe(head);
    expect(api?.contextPath).toBe("agents/backend/AGENTS.md");
    expect(api?.linkedAs).toEqual(["AGENTS.md"]);
    expect(api?.linkMode).toBe("symlink");
    expect(api?.computedHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("restores everything from the lock alone", async () => {
    await addCommand(gitSource(), { target: ["*"], linkAs: ["AGENTS.md"], yes: true });
    rmSync(path.join(project, ".contexts"), { recursive: true, force: true });
    rmSync(path.join(project, "src", "api", "AGENTS.md"), { force: true });
    rmSync(path.join(project, "src", "components", "AGENTS.md"), { force: true });

    await installCommand({});
    for (const t of ["api", "components"]) {
      const lp = path.join(project, "src", t, "AGENTS.md");
      expect(lstatSync(lp).isSymbolicLink()).toBe(true);
      expect(readFileSync(lp, "utf8")).toMatch(/context/i);
    }
  });

  it("is idempotent: a second install changes nothing", async () => {
    await addCommand(gitSource(), { target: ["*"], linkAs: ["AGENTS.md"], yes: true });
    const lp = path.join(project, "src", "api", "AGENTS.md");
    const before = readFileSync(lp, "utf8");
    await installCommand({});
    await installCommand({});
    expect(readFileSync(lp, "utf8")).toBe(before);
    expect(lstatSync(lp).isSymbolicLink()).toBe(true);
  });

  it("fails exit 4 on a content hash mismatch", async () => {
    await addCommand(gitSource(), { target: ["src/api"], linkAs: ["AGENTS.md"], yes: true });
    // Corrupt the lock's recorded hash.
    const lockPath = path.join(project, "contexts.lock");
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    lock.contexts["src/api"].computedHash = "0".repeat(64);
    writeFileSync(lockPath, JSON.stringify(lock));
    rmSync(path.join(project, ".contexts"), { recursive: true, force: true });

    await expect(installCommand({})).rejects.toMatchObject({ exitCode: 4 });
  });

  it("--force re-pins the lock on mismatch", async () => {
    await addCommand(gitSource(), { target: ["src/api"], linkAs: ["AGENTS.md"], yes: true });
    const lockPath = path.join(project, "contexts.lock");
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    const realHash = lock.contexts["src/api"].computedHash;
    lock.contexts["src/api"].computedHash = "0".repeat(64);
    writeFileSync(lockPath, JSON.stringify(lock));
    rmSync(path.join(project, ".contexts"), { recursive: true, force: true });

    await installCommand({ force: true });
    const repinned = await readLock(project);
    expect(repinned?.contexts["src/api"]?.computedHash).toBe(realHash);
  });

  it("materializes the pinned SHA even after upstream advances", async () => {
    await addCommand(gitSource(), { target: ["src/api"], linkAs: ["AGENTS.md"], yes: true });
    const oldContent = readFileSync(path.join(project, "src", "api", "AGENTS.md"), "utf8");

    // Advance the upstream repo with new content for the same file.
    commitChange(repo, "agents/backend/AGENTS.md", "# CHANGED UPSTREAM\n");
    rmSync(path.join(project, ".contexts"), { recursive: true, force: true });

    await installCommand({});
    expect(readFileSync(path.join(project, "src", "api", "AGENTS.md"), "utf8")).toBe(oldContent);
  });

  it("missing lock → exit 4 with actionable message", async () => {
    try {
      await installCommand({});
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).exitCode).toBe(4);
      expect((err as CliError).message).toMatch(/no contexts\.lock/);
    }
    expect(existsSync(path.join(project, "contexts.lock"))).toBe(false);
  });
});
