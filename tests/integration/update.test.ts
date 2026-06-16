import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addCommand } from "../../src/commands/add.js";
import { listCommand } from "../../src/commands/list.js";
import { updateCommand } from "../../src/commands/update.js";
import { readLock } from "../../src/core/lockfile.js";
import { configureReporter } from "../../src/ui/reporter.js";
import { captureJson } from "../helpers/capture.js";
import { cleanup, commitChange, git, initGitRepo, makeTmpDir } from "../helpers/tmp.js";

const FIXTURE = path.resolve(__dirname, "../fixtures/contexts-basic");

describe("update / list — integration", () => {
  let project: string;
  let repo: string;
  let prevCwd: string;

  beforeEach(() => {
    prevCwd = process.cwd();
    project = makeTmpDir("upproj-");
    repo = makeTmpDir("uprepo-");
    initGitRepo(repo, FIXTURE);
    mkdirSync(path.join(project, "src", "api"), { recursive: true });
    mkdirSync(path.join(project, "src", "components"), { recursive: true });
    process.chdir(project);
    configureReporter({ json: false });
  });
  afterEach(() => {
    configureReporter({ json: false });
    process.exitCode = 0;
    process.chdir(prevCwd);
    cleanup(project);
    cleanup(repo);
  });

  const gitSource = () => `file://${repo}`;

  it("list prints a row per lock entry", async () => {
    await addCommand(gitSource(), { target: ["*"], linkAs: ["AGENTS.md"], yes: true });
    configureReporter({ json: true });
    const j = await captureJson<{ entries: { target: string }[] }>(() =>
      listCommand({ json: true }),
    );
    expect(j.entries.map((e) => e.target).sort()).toEqual(["src/api", "src/components"]);
  });

  it("--check exits 5 when behind, 0 when current", async () => {
    await addCommand(gitSource(), { target: ["src/api"], linkAs: ["AGENTS.md"], yes: true });

    // current
    process.exitCode = 0;
    await updateCommand([], { check: true });
    expect(process.exitCode === 0 || process.exitCode === undefined).toBe(true);

    // advance upstream
    commitChange(repo, "agents/backend/AGENTS.md", "# NEW\n");
    process.exitCode = 0;
    await updateCommand([], { check: true });
    expect(process.exitCode).toBe(5);
  });

  it("applies an upstream change, re-links, and re-pins the lock", async () => {
    await addCommand(gitSource(), { target: ["src/api"], linkAs: ["AGENTS.md"], yes: true });
    const before = await readLock(project);
    const oldHash = before?.contexts["src/api"]?.computedHash;
    const oldRef = before?.contexts["src/api"]?.resolvedRef;

    const newRef = commitChange(repo, "agents/backend/AGENTS.md", "# UPDATED CONTENT\n");

    await updateCommand([], { yes: true });

    const lp = path.join(project, "src", "api", "AGENTS.md");
    expect(readFileSync(lp, "utf8")).toBe("# UPDATED CONTENT\n");
    const after = await readLock(project);
    expect(after?.contexts["src/api"]?.computedHash).not.toBe(oldHash);
    expect(after?.contexts["src/api"]?.resolvedRef).toBe(newRef);
    expect(after?.contexts["src/api"]?.resolvedRef).not.toBe(oldRef);
  });

  it("prunes a mapping removed upstream but preserves a hand-edited file", async () => {
    await addCommand(gitSource(), { target: ["*"], linkAs: ["AGENTS.md"], yes: true });

    // Remove the components mapping upstream by rewriting contexts.yml.
    writeFileSync(
      path.join(repo, "contexts.yml"),
      'version: "1"\nmappings:\n  src/api:\n    context_source: ./agents/backend/AGENTS.md\n',
    );
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "drop components"]);

    await updateCommand([], { yes: true });

    // components link (our symlink) pruned; lock entry gone.
    expect(existsSync(path.join(project, "src", "components", "AGENTS.md"))).toBe(false);
    const lock = await readLock(project);
    expect(lock?.contexts["src/components"]).toBeUndefined();
    expect(lock?.contexts["src/api"]).toBeDefined();
  });

  it("does not prune a foreign file that happens to sit at an orphaned path", async () => {
    await addCommand(gitSource(), { target: ["src/api"], linkAs: ["AGENTS.md"], yes: true });

    // Simulate a removed mapping where the user has their own file there.
    // Replace the api symlink with a hand-written file, then drop the mapping.
    const lp = path.join(project, "src", "api", "AGENTS.md");
    rmSync(lp, { force: true });
    writeFileSync(lp, "MINE — keep me\n");
    writeFileSync(
      path.join(repo, "contexts.yml"),
      'version: "1"\nmappings:\n  src/components:\n    context_source: ./agents/frontend/AGENTS.md\n',
    );
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "drop api"]);
    mkdirSync(path.join(project, "src", "components"), { recursive: true });

    await updateCommand([], { yes: true });
    expect(readFileSync(lp, "utf8")).toBe("MINE — keep me\n");
  });
});
