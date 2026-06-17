import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addCommand } from "../../src/commands/add.js";
import { resetCommand } from "../../src/commands/reset.js";
import { configureReporter } from "../../src/ui/reporter.js";
import { cleanup, commitChange, initGitRepo, makeTmpDir } from "../helpers/tmp.js";

const FIXTURE = path.resolve(__dirname, "../fixtures/contexts-basic");

describe("reset — integration", () => {
  let project: string;
  let repo: string;
  let prevCwd: string;

  beforeEach(() => {
    prevCwd = process.cwd();
    project = makeTmpDir("rstproj-");
    repo = makeTmpDir("rstrepo-");
    initGitRepo(repo, FIXTURE);
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

  const gitSource = () => `file://${repo}`;

  it("removes all symlinks and restores .bak backups", async () => {
    // Create hand-written files that will be backed up.
    const apiLink = path.join(project, "src", "api", "AGENTS.md");
    const compLink = path.join(project, "src", "components", "AGENTS.md");
    writeFileSync(apiLink, "hand-written API\n");
    writeFileSync(compLink, "hand-written components\n");

    // add --force backs them up and creates symlinks.
    await addCommand(gitSource(), {
      target: ["*"],
      linkAs: ["AGENTS.md"],
      yes: true,
      force: true,
    });

    expect(existsSync(`${apiLink}.bak`)).toBe(true);
    expect(existsSync(`${compLink}.bak`)).toBe(true);
    expect(readFileSync(`${apiLink}.bak`, "utf8")).toBe("hand-written API\n");
    expect(lstatSync(apiLink).isSymbolicLink()).toBe(true);

    // Reset: remove symlinks, restore .bak, clean lock + cache.
    await resetCommand({ yes: true });

    // Original files restored from .bak.
    expect(readFileSync(apiLink, "utf8")).toBe("hand-written API\n");
    expect(readFileSync(compLink, "utf8")).toBe("hand-written components\n");
    expect(lstatSync(apiLink).isSymbolicLink()).toBe(false);
    expect(lstatSync(apiLink).isFile()).toBe(true);

    // .bak files consumed.
    expect(existsSync(`${apiLink}.bak`)).toBe(false);
    expect(existsSync(`${compLink}.bak`)).toBe(false);

    // Lock and cache gone.
    expect(existsSync(path.join(project, "contexts.lock"))).toBe(false);
    expect(existsSync(path.join(project, ".contexts"))).toBe(false);
  });

  it("no lock → nothing to reset", async () => {
    await resetCommand({ yes: true });
    // Should not throw, just report nothing.
    expect(existsSync(path.join(project, "contexts.lock"))).toBe(false);
  });

  it("dry run reports what would happen without mutating", async () => {
    const apiLink = path.join(project, "src", "api", "AGENTS.md");
    writeFileSync(apiLink, "original\n");
    await addCommand(gitSource(), {
      target: ["src/api"],
      linkAs: ["AGENTS.md"],
      yes: true,
      force: true,
    });

    await resetCommand({ yes: true, dryRun: true });

    // Nothing mutated.
    expect(lstatSync(apiLink).isSymbolicLink()).toBe(true);
    expect(existsSync(`${apiLink}.bak`)).toBe(true);
    expect(existsSync(path.join(project, "contexts.lock"))).toBe(true);
    expect(existsSync(path.join(project, ".contexts"))).toBe(true);
  });

  it("restores .bak even when a foreign file replaced the symlink", async () => {
    const apiLink = path.join(project, "src", "api", "AGENTS.md");
    writeFileSync(apiLink, "hand-written API\n");

    await addCommand(gitSource(), {
      target: ["src/api"],
      linkAs: ["AGENTS.md"],
      yes: true,
      force: true,
    });

    // Manually replace the symlink with a different foreign file.
    const { rmSync } = await import("node:fs");
    rmSync(apiLink, { force: true });
    writeFileSync(apiLink, "foreign file — not contexts-owned\n");

    // Reset: .bak exists so we remove the foreign file and restore the backup.
    await resetCommand({ yes: true });

    expect(readFileSync(apiLink, "utf8")).toBe("hand-written API\n");
    expect(existsSync(`${apiLink}.bak`)).toBe(false);
  });

  it("keeps a foreign file when there is no .bak backup", async () => {
    const apiLink = path.join(project, "src", "api", "AGENTS.md");
    writeFileSync(apiLink, "hand-written API\n");

    await addCommand(gitSource(), {
      target: ["src/api"],
      linkAs: ["AGENTS.md"],
      yes: true,
      force: true,
    });

    // Delete the .bak, replace symlink with foreign file.
    const { rmSync } = await import("node:fs");
    rmSync(`${apiLink}.bak`, { force: true });
    rmSync(apiLink, { force: true });
    writeFileSync(apiLink, "foreign file — not contexts-owned\n");

    await resetCommand({ yes: true });

    // Foreign file preserved since we don't own it and there's no .bak.
    expect(readFileSync(apiLink, "utf8")).toBe("foreign file — not contexts-owned\n");
  });

  it("handles .bak without a current link (link was already deleted)", async () => {
    const apiLink = path.join(project, "src", "api", "AGENTS.md");
    writeFileSync(apiLink, "hand-written API\n");

    await addCommand(gitSource(), {
      target: ["src/api"],
      linkAs: ["AGENTS.md"],
      yes: true,
      force: true,
    });

    // Manually delete the symlink, leave .bak.
    const { rmSync } = await import("node:fs");
    rmSync(apiLink, { force: true });

    await resetCommand({ yes: true });

    // .bak restored to original location.
    expect(readFileSync(apiLink, "utf8")).toBe("hand-written API\n");
    expect(existsSync(`${apiLink}.bak`)).toBe(false);
  });

  it("warns about leftover .bak.N files", async () => {
    const apiLink = path.join(project, "src", "api", "AGENTS.md");
    writeFileSync(apiLink, "original\n");

    await addCommand(gitSource(), {
      target: ["src/api"],
      linkAs: ["AGENTS.md"],
      yes: true,
      force: true,
    });

    // Simulate multiple rounds of conflicts: create .bak.2 manually.
    writeFileSync(`${apiLink}.bak.2`, "intermediate backup\n");
    writeFileSync(`${apiLink}.bak.3`, "another backup\n");

    await resetCommand({ yes: true });

    // .bak restored.
    expect(readFileSync(apiLink, "utf8")).toBe("original\n");
    // .bak consumed.
    expect(existsSync(`${apiLink}.bak`)).toBe(false);
    // .bak.2 and .bak.3 still present (warned about).
    expect(existsSync(`${apiLink}.bak.2`)).toBe(true);
    expect(existsSync(`${apiLink}.bak.3`)).toBe(true);
  });

  it("works with copy-mode entries", async () => {
    const apiLink = path.join(project, "src", "api", "AGENTS.md");
    writeFileSync(apiLink, "hand-written API\n");

    await addCommand(gitSource(), {
      target: ["src/api"],
      linkAs: ["AGENTS.md"],
      yes: true,
      force: true,
      copy: true,
    });

    // Copy mode: the file is a real file (not symlink), hash matches lock.
    expect(lstatSync(apiLink).isFile()).toBe(true);
    expect(lstatSync(apiLink).isSymbolicLink()).toBe(false);

    await resetCommand({ yes: true });

    // Original restored from .bak.
    expect(readFileSync(apiLink, "utf8")).toBe("hand-written API\n");
    expect(existsSync(`${apiLink}.bak`)).toBe(false);
  });

  it("is idempotent: second reset is a no-op", async () => {
    const apiLink = path.join(project, "src", "api", "AGENTS.md");
    writeFileSync(apiLink, "hand-written API\n");

    await addCommand(gitSource(), {
      target: ["src/api"],
      linkAs: ["AGENTS.md"],
      yes: true,
      force: true,
    });

    await resetCommand({ yes: true });
    // Second reset: nothing to do.
    await resetCommand({ yes: true });

    expect(readFileSync(apiLink, "utf8")).toBe("hand-written API\n");
  });

  it("non-interactive without --yes throws", async () => {
    const apiLink = path.join(project, "src", "api", "AGENTS.md");
    writeFileSync(apiLink, "hand-written\n");
    await addCommand(gitSource(), {
      target: ["src/api"],
      linkAs: ["AGENTS.md"],
      yes: true,
      force: true,
    });

    // Simulate non-interactive env (CI=true makes isInteractive false).
    const prevCI = process.env.CI;
    process.env.CI = "true";
    try {
      await expect(resetCommand({})).rejects.toMatchObject({ exitCode: 2 });
    } finally {
      if (prevCI === undefined) delete process.env.CI;
      else process.env.CI = prevCI;
    }
  });

  it("restores .bak even after the upstream repo advanced", async () => {
    const apiLink = path.join(project, "src", "api", "AGENTS.md");
    writeFileSync(apiLink, "hand-written API\n");

    await addCommand(gitSource(), {
      target: ["src/api"],
      linkAs: ["AGENTS.md"],
      yes: true,
      force: true,
    });

    // Advance upstream, update to get new content.
    commitChange(repo, "agents/backend/AGENTS.md", "# NEW UPSTREAM\n");
    const { updateCommand } = await import("../../src/commands/update.js");
    await updateCommand([], { yes: true });

    // Now reset: should restore the .bak from the original add --force.
    // The .bak still has the original hand-written content from before contexts.
    await resetCommand({ yes: true });

    expect(readFileSync(apiLink, "utf8")).toBe("hand-written API\n");
    expect(existsSync(`${apiLink}.bak`)).toBe(false);
  });
});
