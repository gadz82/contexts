import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const BIN = path.join(ROOT, "bin", "contexts.js");
const DIST = path.join(ROOT, "dist", "index.js");

// These tests validate the bin shim + the bundled dist (not the TS source), so
// they build once if the bundle is missing.
describe("dist smoke (subprocess via bin shim)", () => {
  beforeAll(() => {
    if (!existsSync(DIST)) {
      execFileSync("npm", ["run", "build"], { cwd: ROOT, stdio: "ignore" });
    }
  }, 120_000);

  it("happy path: --version prints the version and exits 0", () => {
    const res = spawnSync("node", [BIN, "--version"], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("error path: unknown command exits 2", () => {
    const res = spawnSync("node", [BIN, "definitely-not-a-command"], { encoding: "utf8" });
    expect(res.status).toBe(2);
  });

  it("error path: install with no lock exits 4", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "smoke-"));
    const res = spawnSync("node", [BIN, "install"], { cwd: dir, encoding: "utf8" });
    expect(res.status).toBe(4);
  });
});
