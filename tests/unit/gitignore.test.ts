import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureReporter } from "../../src/ui/reporter.js";
import { ensureIgnored } from "../../src/utils/gitignore.js";
import { cleanup, makeTmpDir } from "../helpers/tmp.js";

describe("ensureIgnored", () => {
  let dir: string;
  const gi = () => path.join(dir, ".gitignore");
  beforeEach(() => {
    dir = makeTmpDir();
    configureReporter({ json: false });
  });
  afterEach(() => cleanup(dir));

  it("creates .gitignore when absent", async () => {
    await ensureIgnored(dir);
    const content = readFileSync(gi(), "utf8");
    expect(content).toContain(".contexts/");
    expect(content).toContain("# contexts cache");
  });

  it("appends once and is idempotent", async () => {
    writeFileSync(gi(), "node_modules\n");
    await ensureIgnored(dir);
    await ensureIgnored(dir);
    const content = readFileSync(gi(), "utf8");
    expect(content.match(/\.contexts\//g)?.length).toBe(1);
    expect(content).toContain("node_modules");
  });

  it("recognizes a pre-existing .contexts (no slash) and does not duplicate", async () => {
    writeFileSync(gi(), ".contexts\n");
    await ensureIgnored(dir);
    const content = readFileSync(gi(), "utf8");
    expect(content.match(/\.contexts/g)?.length).toBe(1);
  });

  it("warns when contexts.lock would be ignored", async () => {
    const warnSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    writeFileSync(gi(), "contexts.lock\n");
    await ensureIgnored(dir);
    const printed = warnSpy.mock.calls.map((c) => String(c[0])).join("\n");
    warnSpy.mockRestore();
    expect(printed).toMatch(/contexts\.lock/);
  });
});
