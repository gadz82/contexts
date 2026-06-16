import { describe, expect, it } from "vitest";
import { CliError, ExitCode } from "../../src/utils/errors.js";

describe("ExitCode table", () => {
  it("maps the docs/03 exit codes exactly", () => {
    expect(ExitCode.Success).toBe(0);
    expect(ExitCode.Unexpected).toBe(1);
    expect(ExitCode.Usage).toBe(2);
    expect(ExitCode.Fetch).toBe(3);
    expect(ExitCode.Lock).toBe(4);
    expect(ExitCode.Findings).toBe(5);
  });
});

describe("CliError", () => {
  it("carries exit code, message, and optional hint", () => {
    const err = new CliError(ExitCode.Usage, "bad flag", "pass --target");
    expect(err).toBeInstanceOf(Error);
    expect(err.exitCode).toBe(2);
    expect(err.message).toBe("bad flag");
    expect(err.hint).toBe("pass --target");
    expect(err.name).toBe("CliError");
  });

  it("allows omitting the hint", () => {
    const err = new CliError(ExitCode.Fetch, "network down");
    expect(err.hint).toBeUndefined();
  });
});
