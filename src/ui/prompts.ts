/**
 * Thin wrappers over @clack/prompts that honor the interactivity rule: in
 * non-interactive contexts (non-TTY, CI, --yes, --json) a prompt that would be
 * required instead throws `CliError(2, ...)` naming the flag to pass.
 *
 * Phase 1 ships the guard + spinner plumbing; selection flows land in phase 4.
 *
 * @see docs/03-cli-reference.md §Interactivity rule
 */
import * as clack from "@clack/prompts";
import type { ConflictChoice } from "../core/linker.js";
import type { LinkOperation, MappingDiagnostic } from "../types.js";
import { CliError, ExitCode } from "../utils/errors.js";
import { COMMON_LINK_NAMES, isValidLinkName } from "../utils/linkname.js";
import { type InteractivityFlags, isInteractive } from "../utils/platform.js";
import { isJsonMode } from "./reporter.js";

/**
 * Assert that prompting is allowed; otherwise abort with a usage error naming
 * the flag the user should pass instead.
 */
export function requireInteractive(flags: InteractivityFlags, missingFlagHint: string): void {
  if (!isInteractive(flags)) {
    throw new CliError(
      ExitCode.Usage,
      "interactive input required but the session is non-interactive",
      missingFlagHint,
    );
  }
}

/** Throw if the user cancelled a clack prompt (Ctrl-C). */
export function assertNotCancelled<T>(value: T | symbol): T {
  if (clack.isCancel(value)) {
    throw new CliError(ExitCode.Usage, "cancelled", "re-run when ready");
  }
  return value as T;
}

/** Start a spinner; returns a stop function. No-op decoration in JSON mode. */
export function spinner(label: string): { stop: (msg?: string) => void } {
  if (isJsonMode()) return { stop: () => {} };
  const s = clack.spinner();
  s.start(label);
  return { stop: (msg?: string) => s.stop(msg ?? label) };
}

/** Interactive multiselect of mappings; returns the chosen target paths. */
export async function selectMappings(diagnostics: MappingDiagnostic[]): Promise<string[]> {
  const choice = await clack.multiselect({
    message: "Select mappings to link",
    options: diagnostics.map((d) => ({
      value: d.target,
      label: d.state === "drifted" ? `${d.target} (drifted — dir will be created)` : d.target,
      hint: d.description ?? d.contextSource,
    })),
    required: true,
  });
  return assertNotCancelled(choice) as string[];
}

/** Interactive multiselect of link filenames, validated. */
export async function selectLinkNames(): Promise<string[]> {
  const choice = await clack.multiselect({
    message: "Link as which filename(s)?",
    options: COMMON_LINK_NAMES.map((n) => ({ value: n, label: n })),
    initialValues: ["AGENTS.md"],
    required: true,
  });
  const names = assertNotCancelled(choice) as string[];
  for (const n of names) {
    if (!isValidLinkName(n)) {
      throw new CliError(ExitCode.Usage, `invalid link name "${n}"`, "use a *.md or dotfile name");
    }
  }
  return names;
}

/** Interactive per-conflict resolution. */
export async function resolveConflictPrompt(op: LinkOperation): Promise<ConflictChoice> {
  const choice = await clack.select({
    message: `A different file already exists at ${op.target}/${op.linkName}`,
    options: [
      { value: "backup", label: "Back up & replace (writes .bak)" },
      { value: "skip", label: "Skip this one" },
      { value: "abort", label: "Abort everything" },
    ],
  });
  return assertNotCancelled(choice) as ConflictChoice;
}

export { clack };
