/**
 * CLI error hierarchy + the canonical exit-code table.
 *
 * Every user-facing failure throws a {@link CliError}; the single top-level
 * handler in `index.ts` formats it via the reporter and exits with the right
 * code. No scattered `process.exit` calls anywhere else.
 *
 * @see docs/03-cli-reference.md §Exit codes
 */

/** Canonical exit codes (docs/03 §Exit codes). */
export const ExitCode = {
  /** Success. */
  Success: 0,
  /** Unexpected error (bug, IO). */
  Unexpected: 1,
  /** Usage/validation error (bad flags, invalid contexts.yml, missing non-interactive choices). */
  Usage: 2,
  /** Source fetch failure (network, auth, bad ref, git missing). */
  Fetch: 3,
  /** Lock integrity failure (missing, unparseable, hash mismatch). */
  Lock: 4,
  /** Status/check findings (status problems, `update --check` has updates). */
  Findings: 5,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

/**
 * A controlled, user-facing error carrying the process exit code and an
 * optional actionable hint (printed dimmed after the message).
 */
export class CliError extends Error {
  readonly exitCode: ExitCodeValue;
  readonly hint?: string;

  constructor(exitCode: ExitCodeValue, message: string, hint?: string) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
    this.hint = hint;
  }
}
