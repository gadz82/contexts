import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { directoryDigest, hashBytes, hashFile } from "../../src/core/hash.js";
import { cleanup, makeTmpDir } from "../helpers/tmp.js";

describe("hashFile / hashBytes", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTmpDir();
  });
  afterEach(() => cleanup(dir));

  it("matches the known sha256 vector for 'abc'", () => {
    expect(hashBytes("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("hashFile equals hashBytes of the same content", () => {
    const f = path.join(dir, "x.md");
    writeFileSync(f, "hello world");
    expect(hashFile(f)).toBe(hashBytes("hello world"));
  });

  it("does not normalize line endings (CRLF differs from LF)", () => {
    expect(hashBytes("a\r\nb")).not.toBe(hashBytes("a\nb"));
  });
});

describe("directoryDigest", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTmpDir();
    mkdirSync(path.join(dir, "sub"), { recursive: true });
    writeFileSync(path.join(dir, "a.txt"), "A");
    writeFileSync(path.join(dir, "sub", "b.txt"), "B");
  });
  afterEach(() => cleanup(dir));

  it("is stable regardless of filesystem enumeration order", () => {
    const first = directoryDigest(dir);
    // Re-create in different write order.
    const dir2 = makeTmpDir();
    mkdirSync(path.join(dir2, "sub"), { recursive: true });
    writeFileSync(path.join(dir2, "sub", "b.txt"), "B");
    writeFileSync(path.join(dir2, "a.txt"), "A");
    expect(directoryDigest(dir2)).toBe(first);
    cleanup(dir2);
  });

  it("changes when a file is renamed", () => {
    const before = directoryDigest(dir);
    renameSync(path.join(dir, "a.txt"), path.join(dir, "renamed.txt"));
    expect(directoryDigest(dir)).not.toBe(before);
  });

  it("changes when content changes", () => {
    const before = directoryDigest(dir);
    writeFileSync(path.join(dir, "a.txt"), "CHANGED");
    expect(directoryDigest(dir)).not.toBe(before);
  });

  it("excludes .git/ contents", () => {
    const before = directoryDigest(dir);
    mkdirSync(path.join(dir, ".git"), { recursive: true });
    writeFileSync(path.join(dir, ".git", "HEAD"), "ref: refs/heads/main");
    expect(directoryDigest(dir)).toBe(before);
  });
});
