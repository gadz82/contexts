import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _resetSymlinkProbe, canSymlink, isCI, isInteractive } from "../../src/utils/platform.js";

describe("isCI", () => {
  const original = process.env.CI;
  afterEach(() => {
    if (original === undefined) delete process.env.CI;
    else process.env.CI = original;
  });

  it("true when CI is set to a truthy value", () => {
    process.env.CI = "true";
    expect(isCI()).toBe(true);
  });

  it("false when CI is unset or 'false'", () => {
    delete process.env.CI;
    expect(isCI()).toBe(false);
    process.env.CI = "false";
    expect(isCI()).toBe(false);
  });
});

describe("isInteractive", () => {
  const originalCI = process.env.CI;
  const originalTTY = process.stdout.isTTY;
  const setTTY = (v: boolean) => {
    Object.defineProperty(process.stdout, "isTTY", { value: v, configurable: true });
  };

  beforeEach(() => {
    delete process.env.CI;
    setTTY(true);
  });
  afterEach(() => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalTTY,
      configurable: true,
    });
    if (originalCI === undefined) delete process.env.CI;
    else process.env.CI = originalCI;
  });

  it("false when --json given", () => {
    expect(isInteractive({ json: true })).toBe(false);
  });

  it("false when --yes given", () => {
    expect(isInteractive({ yes: true })).toBe(false);
  });

  it("false in CI even on a TTY", () => {
    process.env.CI = "1";
    expect(isInteractive({})).toBe(false);
  });

  it("false when not a TTY", () => {
    setTTY(false);
    expect(isInteractive({})).toBe(false);
  });

  it("true on a TTY with no suppressing flags", () => {
    expect(isInteractive({})).toBe(true);
  });
});

describe("canSymlink", () => {
  beforeEach(() => _resetSymlinkProbe());
  it("succeeds on POSIX dev environments", () => {
    // On CI POSIX legs this is true; on restricted FS it returns false without throwing.
    expect(typeof canSymlink()).toBe("boolean");
  });
  it("caches the probe result", () => {
    const first = canSymlink();
    const second = canSymlink();
    expect(first).toBe(second);
  });
});
