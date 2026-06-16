import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CacheService } from "../../src/core/cache.js";
import type { ResolvedSource } from "../../src/types.js";
import { cleanup, initGitRepo, makeTmpDir } from "../helpers/tmp.js";

const SUBPATH_FIXTURE = path.resolve(__dirname, "../fixtures/contexts-subpath");

describe("subpath sources", () => {
  let project: string;
  let repo: string;
  beforeEach(() => {
    project = makeTmpDir("subpathproj-");
    repo = makeTmpDir("subpathrepo-");
    initGitRepo(repo, SUBPATH_FIXTURE);
  });
  afterEach(() => {
    cleanup(project);
    cleanup(repo);
  });

  it("materializes only the subpath as the cache root", async () => {
    const resolved: ResolvedSource = {
      raw: repo,
      source: repo,
      sourceType: "git",
      fetchUrl: repo,
      requestedRef: null,
      subpath: "packages/contexts",
      localPath: null,
    };
    const cache = new CacheService(project);
    const res = await cache.materialize(resolved);

    // contexts.yml lives at the cache root (subpath extracted), not under packages/.
    expect(existsSync(path.join(res.cacheDir, "contexts.yml"))).toBe(true);
    expect(existsSync(path.join(res.cacheDir, "agents/backend/AGENTS.md"))).toBe(true);
    expect(existsSync(path.join(res.cacheDir, "packages"))).toBe(false);
    // Slug encodes the subpath so multiple collections coexist.
    expect(path.basename(res.cacheDir)).toMatch(/^git-[0-9a-f]{12}$/);
  });

  it("rejects a subpath without contexts.yml (exit 2)", async () => {
    const resolved: ResolvedSource = {
      raw: repo,
      source: repo,
      sourceType: "git",
      fetchUrl: repo,
      requestedRef: null,
      subpath: "packages",
      localPath: null,
    };
    const cache = new CacheService(project);
    await expect(cache.materialize(resolved)).rejects.toMatchObject({ exitCode: 2 });
  });
});
