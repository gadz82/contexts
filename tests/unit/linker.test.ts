import { mkdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashBytes, hashFile } from "../../src/core/hash.js";
import {
  type KnownLink,
  _setSymlinkImpl,
  executeLinks,
  planLinks,
  pruneOrphans,
} from "../../src/core/linker.js";
import type { LinkSelection } from "../../src/types.js";
import { configureReporter } from "../../src/ui/reporter.js";
import { cleanup, makeTmpDir } from "../helpers/tmp.js";

const CONTENT = "# ctx\n";

function setup(): { project: string; cache: string; cachedFile: string } {
  const project = makeTmpDir("proj-");
  const cache = path.join(project, ".contexts", "cache", "src");
  mkdirSync(path.join(cache, "agents"), { recursive: true });
  const cachedFile = path.join(cache, "agents", "AGENTS.md");
  writeFileSync(cachedFile, CONTENT);
  return { project, cache, cachedFile };
}

const sel = (target: string, names: string[]): LinkSelection => ({
  target,
  contextPath: "agents/AGENTS.md",
  linkNames: names,
});

describe("planLinks — classification matrix", () => {
  let env: ReturnType<typeof setup>;
  beforeEach(() => {
    env = setup();
    configureReporter({ json: false });
  });
  afterEach(() => cleanup(env.project));

  it("nothing there → create", () => {
    const [op] = planLinks([sel("src/api", ["AGENTS.md"])], env.cache, env.project);
    expect(op?.action).toBe("create");
  });

  it("our symlink already resolving to cache → skip-ok", async () => {
    const ops = planLinks([sel("src/api", ["AGENTS.md"])], env.cache, env.project);
    await executeLinks(ops);
    const replan = planLinks([sel("src/api", ["AGENTS.md"])], env.cache, env.project);
    expect(replan[0]?.action).toBe("skip-ok");
  });

  it("foreign symlink → replace-link", () => {
    const linkDir = path.join(env.project, "src", "api");
    mkdirSync(linkDir, { recursive: true });
    const other = path.join(env.project, "other.md");
    writeFileSync(other, "x");
    symlinkSync(other, path.join(linkDir, "AGENTS.md"));
    const [op] = planLinks([sel("src/api", ["AGENTS.md"])], env.cache, env.project);
    expect(op?.action).toBe("replace-link");
  });

  it("owned copy-mode file (hash matches) → replace-link", () => {
    const linkDir = path.join(env.project, "src", "api");
    mkdirSync(linkDir, { recursive: true });
    writeFileSync(path.join(linkDir, "AGENTS.md"), CONTENT);
    const known: KnownLink[] = [
      { target: "src/api", linkName: "AGENTS.md", computedHash: hashBytes(CONTENT) },
    ];
    const [op] = planLinks([sel("src/api", ["AGENTS.md"])], env.cache, env.project, { known });
    expect(op?.action).toBe("replace-link");
  });

  it("foreign regular file → conflict", () => {
    const linkDir = path.join(env.project, "src", "api");
    mkdirSync(linkDir, { recursive: true });
    writeFileSync(path.join(linkDir, "AGENTS.md"), "hand-written");
    const [op] = planLinks([sel("src/api", ["AGENTS.md"])], env.cache, env.project);
    expect(op?.action).toBe("conflict");
  });

  it("directory at link path → exit 2", () => {
    const linkDir = path.join(env.project, "src", "api", "AGENTS.md");
    mkdirSync(linkDir, { recursive: true });
    expect(() => planLinks([sel("src/api", ["AGENTS.md"])], env.cache, env.project)).toThrow(
      /is a directory/,
    );
  });

  it("computes relative link targets incl. deep nesting and '.' target", () => {
    const deep = planLinks([sel("a/b/c", ["AGENTS.md"])], env.cache, env.project);
    expect(deep[0]?.relTarget).toBe(path.relative(path.join(env.project, "a/b/c"), env.cachedFile));
    expect(deep[0]?.relTarget.startsWith("..")).toBe(true);

    const root = planLinks([sel(".", ["AGENTS.md"])], env.cache, env.project);
    expect(root[0]?.linkPath).toBe(path.join(env.project, "AGENTS.md"));
  });
});

describe("executeLinks", () => {
  let env: ReturnType<typeof setup>;
  beforeEach(() => {
    env = setup();
    configureReporter({ json: false });
  });
  afterEach(() => cleanup(env.project));

  it("creates a relative symlink resolving to the cached file", async () => {
    const ops = planLinks([sel("src/api", ["AGENTS.md"])], env.cache, env.project);
    const [done] = await executeLinks(ops);
    expect(done?.result).toBe("created");
    expect(done?.mode).toBe("symlink");
    const linkPath = path.join(env.project, "src", "api", "AGENTS.md");
    expect(readlinkSync(linkPath)).not.toMatch(/^\//); // relative
  });

  it("falls back to copy on EPERM and records the mode", async () => {
    _setSymlinkImpl(() => Promise.reject(Object.assign(new Error("denied"), { code: "EPERM" })));
    try {
      const ops = planLinks([sel("src/api", ["AGENTS.md"])], env.cache, env.project);
      const [done] = await executeLinks(ops);
      expect(done?.mode).toBe("copy");
      expect(done?.fellBack).toBe(true);
      const linkPath = path.join(env.project, "src", "api", "AGENTS.md");
      expect(hashFile(linkPath)).toBe(hashBytes(CONTENT));
    } finally {
      _setSymlinkImpl(null);
    }
  });

  it("conflict: skip leaves the file, backup writes escalating .bak names", async () => {
    const linkDir = path.join(env.project, "src", "api");
    mkdirSync(linkDir, { recursive: true });
    const linkPath = path.join(linkDir, "AGENTS.md");
    writeFileSync(linkPath, "mine");

    // skip
    let ops = planLinks([sel("src/api", ["AGENTS.md"])], env.cache, env.project);
    let [r] = await executeLinks(ops, { resolveConflict: () => "skip" });
    expect(r?.result).toBe("skipped");

    // backup once
    ops = planLinks([sel("src/api", ["AGENTS.md"])], env.cache, env.project);
    [r] = await executeLinks(ops, { resolveConflict: () => "backup" });
    expect(r?.backupPath).toBe(`${linkPath}.bak`);

    // a fresh foreign file (replace the symlink we just made) + existing .bak → .bak.2
    rmSync(linkPath, { force: true });
    writeFileSync(linkPath, "mine2");
    ops = planLinks([sel("src/api", ["AGENTS.md"])], env.cache, env.project);
    [r] = await executeLinks(ops, { resolveConflict: () => "backup" });
    expect(r?.backupPath).toBe(`${linkPath}.bak.2`);
  });
});

describe("pruneOrphans", () => {
  let env: ReturnType<typeof setup>;
  beforeEach(() => {
    env = setup();
    configureReporter({ json: false });
  });
  afterEach(() => cleanup(env.project));

  it("removes our symlink orphan, keeps a foreign file with a warning", async () => {
    const cacheRoot = path.join(env.project, ".contexts", "cache");
    // our symlink at src/api/AGENTS.md
    const ops = planLinks([sel("src/api", ["AGENTS.md"])], env.cache, env.project);
    await executeLinks(ops);
    // foreign file at src/web/AGENTS.md
    const webDir = path.join(env.project, "src", "web");
    mkdirSync(webDir, { recursive: true });
    writeFileSync(path.join(webDir, "AGENTS.md"), "hand");

    const old: KnownLink[] = [
      { target: "src/api", linkName: "AGENTS.md", computedHash: hashBytes(CONTENT) },
      { target: "src/web", linkName: "AGENTS.md", computedHash: "deadbeef" },
    ];
    const res = await pruneOrphans(old, [], env.project, cacheRoot);
    expect(res.removed.some((p) => p.includes(path.join("src", "api")))).toBe(true);
    expect(res.kept.some((p) => p.includes(path.join("src", "web")))).toBe(true);
  });
});
