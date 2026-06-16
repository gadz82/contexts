import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { diagnose, loadManifest, resolveMappings } from "../../src/core/manifest.js";
import { CliError } from "../../src/utils/errors.js";
import { cleanup, makeTmpDir } from "../helpers/tmp.js";

/** Write a contexts.yml (and optional files) into a fresh cache dir. */
function manifestDir(yml: string, files: Record<string, string> = {}): string {
  const dir = makeTmpDir("manifest-");
  writeFileSync(path.join(dir, "contexts.yml"), yml);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

const FIXTURES = path.resolve(__dirname, "../fixtures");
const fx = (name: string) => path.join(FIXTURES, name);

function expectExit2(fn: () => unknown, messageRe: RegExp): void {
  try {
    fn();
    throw new Error("expected throw");
  } catch (err) {
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).exitCode).toBe(2);
    expect((err as CliError).message).toMatch(messageRe);
  }
}

describe("loadManifest — valid", () => {
  it("parses the basic fixture into normalized mappings", () => {
    const m = loadManifest(fx("contexts-basic"));
    expect(m.version).toBe("1");
    expect(m.name).toBe("contexts-basic");
    const targets = m.mappings.map((x) => x.target).sort();
    expect(targets).toEqual(["src/api", "src/components"]);
    const api = m.mappings.find((x) => x.target === "src/api");
    expect(api?.contextPath).toBe("agents/backend/AGENTS.md");
  });

  it("accepts a root '.' mapping", () => {
    const m = loadManifest(fx("contexts-root"));
    expect(m.mappings.some((x) => x.target === ".")).toBe(true);
  });
});

describe("loadManifest — invalid (each a distinct exit-2 error)", () => {
  it("unknown version", () => {
    expectExit2(() => loadManifest(fx("contexts-invalid-version")), /version "2"/);
  });

  it("no mappings", () => {
    expectExit2(() => loadManifest(fx("contexts-invalid-no-mappings")), /no mappings/);
  });

  it("duplicate normalized keys", () => {
    expectExit2(() => loadManifest(fx("contexts-invalid-duplicate")), /duplicate mapping target/);
  });

  it("context_source traversal", () => {
    expectExit2(() => loadManifest(fx("contexts-invalid-traversal")), /escapes the contexts repo/);
  });

  it("context_source missing file", () => {
    expectExit2(() => loadManifest(fx("contexts-invalid-missing-file")), /does not exist/);
  });

  it("missing manifest entirely", () => {
    const empty = makeTmpDir();
    try {
      expectExit2(() => loadManifest(empty), /no contexts\.yml/);
    } finally {
      cleanup(empty);
    }
  });

  it("invalid YAML", () => {
    const dir = manifestDir("version: : :\n  - bad");
    try {
      expectExit2(() => loadManifest(dir), /not valid YAML/);
    } finally {
      cleanup(dir);
    }
  });

  it("absolute mapping key", () => {
    const dir = manifestDir('version: "1"\nmappings:\n  /etc:\n    context_source: ./a.md\n', {
      "a.md": "x",
    });
    try {
      expectExit2(() => loadManifest(dir), /is absolute/);
    } finally {
      cleanup(dir);
    }
  });

  it("absolute context_source", () => {
    const dir = manifestDir(
      'version: "1"\nmappings:\n  src/api:\n    context_source: /etc/passwd\n',
    );
    try {
      expectExit2(() => loadManifest(dir), /is absolute/);
    } finally {
      cleanup(dir);
    }
  });

  it("context_source pointing at a directory (not a regular file)", () => {
    const dir = manifestDir('version: "1"\nmappings:\n  src/api:\n    context_source: ./agents\n', {
      "agents/keep.md": "x",
    });
    try {
      expectExit2(() => loadManifest(dir), /not a regular file/);
    } finally {
      cleanup(dir);
    }
  });

  it("schema error: missing context_source", () => {
    const dir = manifestDir('version: "1"\nmappings:\n  src/api:\n    description: no source\n');
    try {
      expectExit2(() => loadManifest(dir), /invalid contexts\.yml/);
    } finally {
      cleanup(dir);
    }
  });
});

describe("tags + resolveMappings", () => {
  const byTarget = (ms: { target: string; contextPath: string }[]) =>
    Object.fromEntries(ms.map((m) => [m.target, m.contextPath]));

  it("loads tags alongside root mappings", () => {
    const m = loadManifest(fx("contexts-tags"));
    expect(Object.keys(m.tags)).toEqual(["experimental"]);
    expect(m.mappings.map((x) => x.target)).toEqual(["src/api"]);
  });

  it("no tag → root mappings unchanged", () => {
    const m = loadManifest(fx("contexts-tags"));
    expect(byTarget(resolveMappings(m))).toEqual({
      "src/api": "agents/backend/AGENTS.md",
    });
  });

  it("tag overrides matching targets and adds new ones", () => {
    const m = loadManifest(fx("contexts-tags"));
    expect(byTarget(resolveMappings(m, "experimental"))).toEqual({
      "src/api": "agents/backend/AGENTS.exp.md", // overridden
      "src/docs": "agents/docs/AGENTS.md", // added
    });
  });

  it("unknown tag → exit 2 listing available tags", () => {
    const m = loadManifest(fx("contexts-tags"));
    expectExit2(() => resolveMappings(m, "nope"), /unknown tag "nope"/);
  });

  it("a tag with no mappings → exit 2", () => {
    const dir = manifestDir(
      'version: "1"\nmappings:\n  src/api:\n    context_source: ./a.md\ntags:\n  empty:\n    mappings: {}\n',
      { "a.md": "x" },
    );
    try {
      expectExit2(() => loadManifest(dir), /tag "empty" has no mappings/);
    } finally {
      cleanup(dir);
    }
  });
});

describe("diagnose", () => {
  let project: string;
  beforeEach(() => {
    project = makeTmpDir();
  });
  afterEach(() => cleanup(project));

  it("marks existing target dirs valid and missing ones drifted", () => {
    mkdirSync(path.join(project, "src", "components"), { recursive: true });
    const m = loadManifest(fx("contexts-basic"));
    const diags = diagnose(m, project);
    const byTarget = Object.fromEntries(diags.map((d) => [d.target, d.state]));
    expect(byTarget["src/components"]).toBe("valid");
    expect(byTarget["src/api"]).toBe("drifted");
  });

  it("root '.' mapping is always valid (project root exists)", () => {
    const m = loadManifest(fx("contexts-root"));
    const diags = diagnose(m, project);
    expect(diags.find((d) => d.target === ".")?.state).toBe("valid");
  });
});
