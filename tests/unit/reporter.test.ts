import { afterEach, describe, expect, it, vi } from "vitest";
import { configureReporter, table } from "../../src/ui/reporter.js";

describe("reporter.table", () => {
  afterEach(() => configureReporter({ json: false, verbose: false }));

  it("renders an aligned table (snapshot)", () => {
    configureReporter({ json: false });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const out = table(
      ["target", "mode", "state"],
      [
        ["src/api", "symlink", "ok"],
        ["src/components", "copy", "modified"],
      ],
    );
    logSpy.mockRestore();
    expect(out).toBe(
      [
        "target          mode     state",
        "--------------  -------  --------",
        "src/api         symlink  ok",
        "src/components  copy     modified",
      ].join("\n"),
    );
  });

  it("does not print in JSON mode but still returns the string", () => {
    configureReporter({ json: true });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const out = table(["a"], [["b"]]);
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    expect(out).toContain("a");
  });
});
