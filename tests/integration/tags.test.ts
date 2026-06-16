import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addCommand } from "../../src/commands/add.js";
import { updateCommand } from "../../src/commands/update.js";
import { readLock } from "../../src/core/lockfile.js";
import { configureReporter } from "../../src/ui/reporter.js";
import { CliError } from "../../src/utils/errors.js";
import { cleanup, makeTmpDir } from "../helpers/tmp.js";

const FIXTURE = path.resolve(__dirname, "../fixtures/contexts-tags");

describe("tags — add/update --tag", () => {
  let project: string;
  let prevCwd: string;
  beforeEach(() => {
    prevCwd = process.cwd();
    project = makeTmpDir("tagproj-");
    mkdirSync(path.join(project, "src", "api"), { recursive: true });
    mkdirSync(path.join(project, "src", "docs"), { recursive: true });
    process.chdir(project);
    configureReporter({ json: false });
  });
  afterEach(() => {
    configureReporter({ json: false });
    process.exitCode = 0;
    process.chdir(prevCwd);
    cleanup(project);
  });

  const read = (t: string) => readFileSync(path.join(project, "src", t, "AGENTS.md"), "utf8");

  it("default (no tag) links the root context", async () => {
    await addCommand(FIXTURE, { target: ["*"], linkAs: ["AGENTS.md"], yes: true });
    expect(read("api")).toBe("# Default API\n");
    const lock = await readLock(project);
    expect(lock?.contexts["src/api"]?.tag).toBeUndefined();
  });

  it("--tag overrides matching targets and adds tag-only targets, recording the tag", async () => {
    await addCommand(FIXTURE, {
      target: ["*"],
      linkAs: ["AGENTS.md"],
      yes: true,
      tag: "experimental",
    });
    expect(read("api")).toBe("# EXPERIMENTAL API\n"); // overridden
    expect(read("docs")).toBe("# Docs context\n"); // tag-only target added

    const lock = await readLock(project);
    expect(lock?.contexts["src/api"]?.tag).toBe("experimental");
    expect(lock?.contexts["src/api"]?.contextPath).toBe("agents/backend/AGENTS.exp.md");
    expect(lock?.contexts["src/docs"]).toBeDefined();
  });

  it("unknown --tag → exit 2", async () => {
    try {
      await addCommand(FIXTURE, {
        target: ["src/api"],
        linkAs: ["AGENTS.md"],
        yes: true,
        tag: "nope",
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).exitCode).toBe(2);
    }
  });

  it("update --tag switches context for an already-installed entry", async () => {
    await addCommand(FIXTURE, { target: ["src/api"], linkAs: ["AGENTS.md"], yes: true });
    expect(read("api")).toBe("# Default API\n");

    await updateCommand([], { yes: true, tag: "experimental" });
    expect(read("api")).toBe("# EXPERIMENTAL API\n");
    const lock = await readLock(project);
    expect(lock?.contexts["src/api"]?.tag).toBe("experimental");
    expect(lock?.contexts["src/api"]?.contextPath).toBe("agents/backend/AGENTS.exp.md");
  });

  it("update --tag default rolls back to root and prunes tag-only targets", async () => {
    // Install the experimental tag: src/api overridden + src/docs added.
    await addCommand(FIXTURE, {
      target: ["*"],
      linkAs: ["AGENTS.md"],
      yes: true,
      tag: "experimental",
    });
    expect(read("api")).toBe("# EXPERIMENTAL API\n");
    expect(existsSync(path.join(project, "src", "docs", "AGENTS.md"))).toBe(true);

    // Roll back to default.
    await updateCommand([], { yes: true, tag: "default" });

    // src/api back to the root context, tag cleared.
    expect(read("api")).toBe("# Default API\n");
    const lock = await readLock(project);
    expect(lock?.contexts["src/api"]?.tag).toBeUndefined();
    expect(lock?.contexts["src/api"]?.contextPath).toBe("agents/backend/AGENTS.md");

    // src/docs has no root mapping → symlink removed + lock entry pruned.
    expect(existsSync(path.join(project, "src", "docs", "AGENTS.md"))).toBe(false);
    expect(lock?.contexts["src/docs"]).toBeUndefined();
  });

  it("update (no --tag) keeps the recorded tag", async () => {
    await addCommand(FIXTURE, {
      target: ["src/api"],
      linkAs: ["AGENTS.md"],
      yes: true,
      tag: "experimental",
    });
    await updateCommand([], { yes: true });
    expect(read("api")).toBe("# EXPERIMENTAL API\n");
    const lock = await readLock(project);
    expect(lock?.contexts["src/api"]?.tag).toBe("experimental");
    expect(existsSync(path.join(project, "src", "api", "AGENTS.md"))).toBe(true);
  });
});
