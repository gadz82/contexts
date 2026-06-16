import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addCommand } from "../../src/commands/add.js";
import { statusCommand } from "../../src/commands/status.js";
import { configureReporter } from "../../src/ui/reporter.js";
import { captureJson } from "../helpers/capture.js";
import { cleanup, makeTmpDir } from "../helpers/tmp.js";

const FIXTURE = path.resolve(__dirname, "../fixtures/contexts-basic");

interface StatusJson {
  entries: { target: string; linkName: string; state: string }[];
}

describe("status — state matrix", () => {
  let project: string;
  let prevCwd: string;

  beforeEach(async () => {
    prevCwd = process.cwd();
    project = makeTmpDir("statusproj-");
    mkdirSync(path.join(project, "src", "api"), { recursive: true });
    mkdirSync(path.join(project, "src", "components"), { recursive: true });
    process.chdir(project);
    configureReporter({ json: false });
    await addCommand(FIXTURE, { target: ["*"], linkAs: ["AGENTS.md"], yes: true });
    configureReporter({ json: true });
  });
  afterEach(() => {
    configureReporter({ json: false });
    process.exitCode = 0;
    process.chdir(prevCwd);
    cleanup(project);
  });

  const stateOf = (j: StatusJson, target: string) =>
    j.entries.find((e) => e.target === target)?.state;

  it("ok when links resolve and hashes match (exit 0)", async () => {
    const j = await captureJson<StatusJson>(() => statusCommand({ remote: false, json: true }));
    expect(stateOf(j, "src/api")).toBe("ok");
    expect(process.exitCode === 0 || process.exitCode === undefined).toBe(true);
  });

  it("modified when the cached content no longer matches the lock (exit 5)", async () => {
    // Symlinked content changed underneath → hash mismatch vs lock.
    const cacheRoot = path.join(project, ".contexts", "cache");
    const slug = readdirSync(cacheRoot)[0] as string;
    writeFileSync(path.join(cacheRoot, slug, "agents/backend/AGENTS.md"), "TAMPERED\n");
    const j = await captureJson<StatusJson>(() => statusCommand({ json: true }));
    expect(stateOf(j, "src/api")).toBe("modified");
    expect(process.exitCode).toBe(5);
  });

  it("broken when the cache is gone (exit 5)", async () => {
    rmSync(path.join(project, ".contexts"), { recursive: true, force: true });
    const j = await captureJson<StatusJson>(() => statusCommand({ json: true }));
    expect(stateOf(j, "src/api")).toBe("broken");
    expect(process.exitCode).toBe(5);
  });

  it("missing when the link is deleted (exit 5)", async () => {
    rmSync(path.join(project, "src", "api", "AGENTS.md"), { force: true });
    const j = await captureJson<StatusJson>(() => statusCommand({ json: true }));
    expect(stateOf(j, "src/api")).toBe("missing");
    expect(process.exitCode).toBe(5);
  });

  it("drifted when the target directory disappears (exit 5)", async () => {
    rmSync(path.join(project, "src", "api"), { recursive: true, force: true });
    const j = await captureJson<StatusJson>(() => statusCommand({ json: true }));
    expect(stateOf(j, "src/api")).toBe("drifted");
    expect(process.exitCode).toBe(5);
  });
});
