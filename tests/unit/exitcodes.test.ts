import { describe, expect, it } from "vitest";
import { CliError, ExitCode } from "../../src/utils/errors.js";

/**
 * Error catalog: every CliError carries one of the documented codes and a
 * non-empty message. The per-command code paths are exercised in the
 * integration suites; this asserts the table contract itself.
 *
 * @see docs/03-cli-reference.md §Exit codes
 */
describe("exit-code catalog", () => {
  const cases: [string, number][] = [
    ["Success", 0],
    ["Unexpected", 1],
    ["Usage", 2],
    ["Fetch", 3],
    ["Lock", 4],
    ["Findings", 5],
  ];

  it.each(cases)("ExitCode.%s === %i", (name, code) => {
    expect(ExitCode[name as keyof typeof ExitCode]).toBe(code);
  });

  it("codes are unique", () => {
    const values = Object.values(ExitCode);
    expect(new Set(values).size).toBe(values.length);
  });

  it.each([ExitCode.Usage, ExitCode.Fetch, ExitCode.Lock, ExitCode.Findings])(
    "a CliError(%i) preserves its code and message",
    (code) => {
      const err = new CliError(code, "something happened", "do this next");
      expect(err.exitCode).toBe(code);
      expect(err.message.length).toBeGreaterThan(0);
      expect(err.hint).toBe("do this next");
    },
  );
});
