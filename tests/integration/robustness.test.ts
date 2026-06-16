import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addCommand } from "../../src/commands/add.js";
import { statusCommand } from "../../src/commands/status.js";
import { CacheService } from "../../src/core/cache.js";
import { hashFile } from "../../src/core/hash.js";
import type { ResolvedSource } from "../../src/types.js";
import { configureReporter } from "../../src/ui/reporter.js";
import { cleanup, makeTmpDir } from "../helpers/tmp.js";

function writeContextsRepo(dir: string, agentBytes: string): void {
  mkdirSync(path.join(dir, "agents"), { recursive: true });
  writeFileSync(
    path.join(dir, "contexts.yml"),
    'version: "1"\nmappings:\n  "src/space dir":\n    context_source: ./agents/AGENTS.md\n',
  );
  writeFileSync(path.join(dir, "agents", "AGENTS.md"), agentBytes);
}

const localSource = (p: string): ResolvedSource => ({
  raw: p,
  source: p,
  sourceType: "local",
  fetchUrl: null,
  requestedRef: null,
  subpath: null,
  localPath: p,
});

describe("robustness", () => {
  let project: string;
  let repo: string;
  let prevCwd: string;
  beforeEach(() => {
    prevCwd = process.cwd();
    project = makeTmpDir("robproj-");
    repo = makeTmpDir("robrepo-");
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

  it("CRLF content hashes identically through the cache copy (no EOL normalization)", async () => {
    const crlf = "# title\r\nline one\r\nline two\r\n";
    writeContextsRepo(repo, crlf);
    const srcHash = hashFile(path.join(repo, "agents", "AGENTS.md"));

    const cache = new CacheService(project);
    const res = await cache.materialize(localSource(repo));
    const cachedHash = hashFile(path.join(res.cacheDir, "agents", "AGENTS.md"));
    expect(cachedHash).toBe(srcHash);
  });

  it("handles hostile target names (spaces) and pre-existing dead symlinks", async () => {
    writeContextsRepo(repo, "# ctx\n");
    mkdirSync(path.join(project, "src", "space dir"), { recursive: true });
    // A pre-existing dead symlink elsewhere must not break anything.
    symlinkSync(path.join(project, "nonexistent-target"), path.join(project, "dangling"));

    await addCommand(repo, { target: ["*"], linkAs: ["AGENTS.md"], yes: true });
    const lp = path.join(project, "src", "space dir", "AGENTS.md");
    expect(readFileSync(lp, "utf8")).toBe("# ctx\n");

    configureReporter({ json: true });
    process.exitCode = 0;
    await statusCommand({ json: true });
    expect(process.exitCode === 0 || process.exitCode === undefined).toBe(true);
  });
});
