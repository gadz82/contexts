import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addCommand } from "../../src/commands/add.js";
import { configureReporter } from "../../src/ui/reporter.js";
import { cleanup, makeTmpDir } from "../helpers/tmp.js";

const FIXTURE = path.resolve(__dirname, "../fixtures/contexts-basic");

describe("add — integration (flag-driven, no lock yet)", () => {
  let project: string;
  let prevCwd: string;

  beforeEach(() => {
    prevCwd = process.cwd();
    project = makeTmpDir("addproj-");
    mkdirSync(path.join(project, "src", "components"), { recursive: true });
    mkdirSync(path.join(project, "src", "api"), { recursive: true });
    process.chdir(project);
    configureReporter({ json: false });
  });
  afterEach(() => {
    process.chdir(prevCwd);
    cleanup(project);
  });

  it("creates working relative symlinks and updates .gitignore", async () => {
    await addCommand(FIXTURE, { target: ["*"], linkAs: ["AGENTS.md", "CLAUDE.md"], yes: true });

    for (const t of ["components", "api"]) {
      for (const name of ["AGENTS.md", "CLAUDE.md"]) {
        const lp = path.join(project, "src", t, name);
        expect(lstatSync(lp).isSymbolicLink()).toBe(true);
        expect(readlinkSync(lp).startsWith("/")).toBe(false); // relative
        expect(readFileSync(lp, "utf8")).toMatch(/context/i); // resolves into cache
      }
    }
    expect(readFileSync(path.join(project, ".gitignore"), "utf8")).toContain(".contexts/");
  });

  it("is idempotent: a second identical run leaves links unchanged", async () => {
    await addCommand(FIXTURE, { target: ["*"], linkAs: ["AGENTS.md"], yes: true });
    const lp = path.join(project, "src", "api", "AGENTS.md");
    const before = readlinkSync(lp);
    await addCommand(FIXTURE, { target: ["*"], linkAs: ["AGENTS.md"], yes: true });
    expect(readlinkSync(lp)).toBe(before);
    expect(lstatSync(lp).isSymbolicLink()).toBe(true);
  });

  it("conflict: skipped without --force, backed up + replaced with --force", async () => {
    const lp = path.join(project, "src", "api", "AGENTS.md");
    writeFileSync(lp, "hand-written\n");

    // no force → skip, file preserved, no symlink
    await addCommand(FIXTURE, { target: ["src/api"], linkAs: ["AGENTS.md"], yes: true });
    expect(lstatSync(lp).isSymbolicLink()).toBe(false);
    expect(readFileSync(lp, "utf8")).toBe("hand-written\n");

    // force → backup written, link replaces file
    await addCommand(FIXTURE, {
      target: ["src/api"],
      linkAs: ["AGENTS.md"],
      yes: true,
      force: true,
    });
    expect(existsSync(`${lp}.bak`)).toBe(true);
    expect(readFileSync(`${lp}.bak`, "utf8")).toBe("hand-written\n");
    expect(lstatSync(lp).isSymbolicLink()).toBe(true);
  });

  it("--copy produces regular files, not symlinks", async () => {
    await addCommand(FIXTURE, {
      target: ["src/api"],
      linkAs: ["AGENTS.md"],
      yes: true,
      copy: true,
    });
    const lp = path.join(project, "src", "api", "AGENTS.md");
    expect(lstatSync(lp).isSymbolicLink()).toBe(false);
    expect(lstatSync(lp).isFile()).toBe(true);
    expect(readFileSync(lp, "utf8")).toMatch(/context/i);
  });

  it("portability: links still resolve after the project dir is moved", async () => {
    await addCommand(FIXTURE, { target: ["src/api"], linkAs: ["AGENTS.md"], yes: true });
    process.chdir(prevCwd);
    const moved = makeTmpDir("moved-");
    cpSync(project, moved, { recursive: true, verbatimSymlinks: true });
    try {
      const lp = path.join(moved, "src", "api", "AGENTS.md");
      expect(lstatSync(lp).isSymbolicLink()).toBe(true);
      expect(readFileSync(lp, "utf8")).toMatch(/context/i);
    } finally {
      cleanup(moved);
    }
  });

  it("drifted-only target without --include-drifted links nothing", async () => {
    cleanup(path.join(project, "src", "api"));
    cleanup(path.join(project, "src", "components"));
    await addCommand(FIXTURE, { yes: true });
    expect(existsSync(path.join(project, "src", "api", "AGENTS.md"))).toBe(false);
  });
});
