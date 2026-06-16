import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSource } from "../../src/core/source.js";
import { CliError } from "../../src/utils/errors.js";

const FIXTURES = path.resolve(__dirname, "../fixtures");

describe("parseSource — github", () => {
  it("shorthand org/repo", () => {
    const r = parseSource("your-org/engineering-contexts", "/tmp");
    expect(r.sourceType).toBe("github");
    expect(r.source).toBe("your-org/engineering-contexts");
    expect(r.fetchUrl).toBe("https://github.com/your-org/engineering-contexts.git");
    expect(r.requestedRef).toBeNull();
    expect(r.subpath).toBeNull();
  });

  it("full github URL strips .git", () => {
    const r = parseSource("https://github.com/org/repo.git", "/tmp");
    expect(r.sourceType).toBe("github");
    expect(r.source).toBe("org/repo");
    expect(r.fetchUrl).toBe("https://github.com/org/repo.git");
  });

  it("tree URL captures ref and subpath", () => {
    const r = parseSource("https://github.com/org/repo/tree/main/packages/contexts", "/tmp");
    expect(r.sourceType).toBe("github");
    expect(r.source).toBe("org/repo");
    expect(r.requestedRef).toBe("main");
    expect(r.subpath).toBe("packages/contexts");
  });

  it("tree URL with ref only", () => {
    const r = parseSource("https://github.com/org/repo/tree/v2", "/tmp");
    expect(r.requestedRef).toBe("v2");
    expect(r.subpath).toBeNull();
  });
});

describe("parseSource — #ref pin", () => {
  it("splits #ref before other parsing", () => {
    const r = parseSource("org/repo#v1.2.3", "/tmp");
    expect(r.source).toBe("org/repo");
    expect(r.requestedRef).toBe("v1.2.3");
  });

  it("rejects empty ref", () => {
    expect(() => parseSource("org/repo#", "/tmp")).toThrow(/empty ref/);
  });

  it("rejects #ref on local sources (exit 2)", () => {
    expect(() => parseSource("./local#main", "/tmp")).toThrow(/not applicable to local/);
  });
});

describe("parseSource — git", () => {
  it("ssh url", () => {
    const r = parseSource("git@github.com:org/repo.git", "/tmp");
    expect(r.sourceType).toBe("git");
    expect(r.source).toBe("git@github.com:org/repo.git");
    expect(r.fetchUrl).toBe("git@github.com:org/repo.git");
  });

  it("non-github https is generic git, kept as-is", () => {
    const r = parseSource("https://gitlab.com/org/repo", "/tmp");
    expect(r.sourceType).toBe("git");
    expect(r.source).toBe("https://gitlab.com/org/repo");
  });
});

describe("parseSource — local", () => {
  it("absolute path", () => {
    const abs = path.join(FIXTURES, "contexts-basic");
    const r = parseSource(abs, "/tmp");
    expect(r.sourceType).toBe("local");
    expect(r.localPath).toBe(abs);
    expect(r.source).toBe(abs);
  });

  it("relative ./ path resolves against cwd", () => {
    const r = parseSource("./contexts-basic", FIXTURES);
    expect(r.sourceType).toBe("local");
    expect(r.localPath).toBe(path.join(FIXTURES, "contexts-basic"));
  });

  it("ambiguous shorthand that exists on disk is treated as local", () => {
    // cwd=FIXTURES, "contexts-basic/agents" matches shorthand AND exists.
    const r = parseSource("contexts-basic/agents", FIXTURES);
    expect(r.sourceType).toBe("local");
    expect(r.localPath).toBe(path.join(FIXTURES, "contexts-basic", "agents"));
  });
});

describe("parseSource — rejections", () => {
  it("empty source (exit 2)", () => {
    expect(() => parseSource("   ", "/tmp")).toThrow(CliError);
  });

  it("uninterpretable source (exit 2)", () => {
    try {
      parseSource("not a valid source!!", "/tmp");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).exitCode).toBe(2);
    }
  });
});
