import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CacheService } from "../../src/core/cache.js";
import type { ResolvedSource } from "../../src/types.js";
import { CliError } from "../../src/utils/errors.js";
import { cleanup, initGitRepo, makeTmpDir } from "../helpers/tmp.js";

const FIXTURE = path.resolve(__dirname, "../fixtures/contexts-basic");

function localSource(localPath: string): ResolvedSource {
  return {
    raw: localPath,
    source: localPath,
    sourceType: "local",
    fetchUrl: null,
    requestedRef: null,
    subpath: null,
    localPath,
  };
}

function gitSource(url: string): ResolvedSource {
  return {
    raw: url,
    source: url,
    sourceType: "git",
    fetchUrl: url,
    requestedRef: null,
    subpath: null,
    localPath: null,
  };
}

describe("CacheService.materialize — local", () => {
  let project: string;
  beforeEach(() => {
    project = makeTmpDir();
  });
  afterEach(() => cleanup(project));

  it("copies the source into the cache with a meta sidecar and digest", async () => {
    const cache = new CacheService(project);
    const res = await cache.materialize(localSource(FIXTURE));

    expect(existsSync(path.join(res.cacheDir, "contexts.yml"))).toBe(true);
    expect(existsSync(path.join(res.cacheDir, "agents/frontend/AGENTS.md"))).toBe(true);
    expect(res.resolvedRef).toBeNull();
    expect(res.directoryDigest).toMatch(/^[0-9a-f]{64}$/);

    const meta = JSON.parse(readFileSync(path.join(res.cacheDir, ".contexts-meta.json"), "utf8"));
    expect(meta.sourceType).toBe("local");
    expect(meta.resolvedRef).toBeNull();
    expect(meta.directoryDigest).toBe(res.directoryDigest);
    expect(meta.fetchedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);

    // slug is local-<hash12>
    expect(path.basename(res.cacheDir)).toMatch(/^local-[0-9a-f]{12}$/);
  });

  it("rejects a directory without contexts.yml (exit 2)", async () => {
    const empty = makeTmpDir();
    const cache = new CacheService(project);
    try {
      await cache.materialize(localSource(empty));
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).exitCode).toBe(2);
      expect((err as CliError).message).toMatch(/doesn't look like a contexts repository/);
    } finally {
      cleanup(empty);
    }
  });
});

describe("CacheService.materialize — git (local repo stand-in)", () => {
  let project: string;
  let repo: string;
  beforeEach(() => {
    project = makeTmpDir();
    repo = makeTmpDir("contexts-repo-");
  });
  afterEach(() => {
    cleanup(project);
    cleanup(repo);
  });

  it("clones at HEAD, drops .git, records resolvedRef", async () => {
    const head = initGitRepo(repo, FIXTURE);
    const cache = new CacheService(project);
    const res = await cache.materialize(gitSource(repo));

    expect(res.resolvedRef).toBe(head);
    expect(existsSync(path.join(res.cacheDir, "contexts.yml"))).toBe(true);
    expect(existsSync(path.join(res.cacheDir, ".git"))).toBe(false);
    expect(path.basename(res.cacheDir)).toMatch(/^git-[0-9a-f]{12}$/);

    const meta = JSON.parse(readFileSync(path.join(res.cacheDir, ".contexts-meta.json"), "utf8"));
    expect(meta.resolvedRef).toBe(head);
  });

  it("re-materializing replaces the cache atomically", async () => {
    initGitRepo(repo, FIXTURE);
    const cache = new CacheService(project);
    await cache.materialize(gitSource(repo));
    const res = await cache.materialize(gitSource(repo));
    expect(existsSync(path.join(res.cacheDir, "contexts.yml"))).toBe(true);
  });
});
