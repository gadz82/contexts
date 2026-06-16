import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LOCK_FILE,
  type LockEntry,
  type LockFile,
  mergeEntries,
  readLock,
  stableStringify,
  writeLock,
} from "../../src/core/lockfile.js";
import { CliError } from "../../src/utils/errors.js";
import { cleanup, makeTmpDir } from "../helpers/tmp.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

const entry = (over: Partial<LockEntry> = {}): LockEntry => ({
  source: "org/repo",
  sourceType: "github",
  resolvedRef: "9f2c1e7a4b5d3f8e0a1b2c3d4e5f60718293a4b5",
  contextPath: "agents/backend/AGENTS.md",
  linkedAs: ["AGENTS.md"],
  linkMode: "symlink",
  computedHash: HASH_A,
  ...over,
});

describe("writeLock / readLock round trip", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTmpDir();
  });
  afterEach(() => cleanup(dir));

  it("is byte-stable and sorts keys recursively", async () => {
    const lock: LockFile = {
      version: 1,
      contexts: {
        "src/components": entry({ linkedAs: ["CLAUDE.md", "AGENTS.md"] }),
        "src/api": entry(),
      },
    };
    await writeLock(dir, lock);
    const text = readFileSync(path.join(dir, LOCK_FILE), "utf8");
    // Trailing newline.
    expect(text.endsWith("\n")).toBe(true);
    // Target keys sorted: src/api before src/components.
    expect(text.indexOf('"src/api"')).toBeLessThan(text.indexOf('"src/components"'));
    // Round trips.
    const back = await readLock(dir);
    expect(back).toEqual(lock);
    // Writing the parsed value again is byte-identical.
    await writeLock(dir, back as LockFile);
    expect(readFileSync(path.join(dir, LOCK_FILE), "utf8")).toBe(text);
  });

  it("returns null when absent", async () => {
    expect(await readLock(dir)).toBeNull();
  });

  it("throws exit 4 on invalid JSON", async () => {
    writeFileSync(path.join(dir, LOCK_FILE), "{not json");
    await expect(readLock(dir)).rejects.toMatchObject({ exitCode: 4 });
  });

  it("throws exit 4 on schema violation", async () => {
    writeFileSync(
      path.join(dir, LOCK_FILE),
      JSON.stringify({ version: 1, contexts: { "src/api": { source: "x" } } }),
    );
    await expect(readLock(dir)).rejects.toBeInstanceOf(CliError);
  });

  it("refuses a newer lock version with an upgrade hint", async () => {
    writeFileSync(path.join(dir, LOCK_FILE), JSON.stringify({ version: 2, contexts: {} }));
    await expect(readLock(dir)).rejects.toMatchObject({ exitCode: 4 });
  });
});

describe("mergeEntries", () => {
  it("replaces same-target entries and preserves others (no duplicates)", () => {
    const existing: LockFile = {
      version: 1,
      contexts: { "src/api": entry({ computedHash: HASH_A }), "src/web": entry() },
    };
    const merged = mergeEntries(existing, { "src/api": entry({ computedHash: HASH_B }) });
    expect(Object.keys(merged.contexts).sort()).toEqual(["src/api", "src/web"]);
    expect(merged.contexts["src/api"]?.computedHash).toBe(HASH_B);
    expect(merged.version).toBe(1);
  });

  it("starts from empty when there is no existing lock", () => {
    const merged = mergeEntries(null, { "src/api": entry() });
    expect(Object.keys(merged.contexts)).toEqual(["src/api"]);
  });
});

describe("stableStringify", () => {
  it("sorts nested keys deterministically", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(
      '{\n  "a": {\n    "c": 3,\n    "d": 2\n  },\n  "b": 1\n}',
    );
  });
});
