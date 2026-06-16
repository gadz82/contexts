/**
 * All user-facing output flows through here. In `--json` mode every decoration
 * is silenced and only `json()` emits to stdout.
 *
 * This is the only module permitted to call `console.log` (biome enforced).
 *
 * @see docs/03-cli-reference.md §UX conventions
 */
import pc from "picocolors";

let jsonMode = false;
let verboseMode = false;

/** Configure global output mode. Called once from the command layer. */
export function configureReporter(opts: { json?: boolean; verbose?: boolean }): void {
  jsonMode = Boolean(opts.json);
  verboseMode = Boolean(opts.verbose);
}

export function isJsonMode(): boolean {
  return jsonMode;
}

export function isVerbose(): boolean {
  return verboseMode;
}

const PREFIX = pc.cyan("◆");

/** Opening banner: `◆ contexts vX.Y.Z`. Suppressed in JSON mode. */
export function intro(version: string): void {
  if (jsonMode) return;
  console.log(`${PREFIX} ${pc.bold("contexts")} ${pc.dim(`v${version}`)}`);
}

/** Closing line. Suppressed in JSON mode. */
export function outro(message: string): void {
  if (jsonMode) return;
  console.log(`${pc.green("✓")} ${message}`);
}

export function info(message: string): void {
  if (jsonMode) return;
  console.log(message);
}

export function warn(message: string): void {
  if (jsonMode) return;
  console.log(`${pc.yellow("⚠")} ${pc.yellow(message)}`);
}

export function error(message: string, hint?: string): void {
  if (jsonMode) return;
  console.error(`${pc.red("✗")} ${pc.red(message)}`);
  if (hint) console.error(`  ${pc.dim(hint)}`);
}

/** Verbose-only diagnostic line (dimmed). */
export function debug(message: string): void {
  if (jsonMode || !verboseMode) return;
  console.log(pc.dim(message));
}

/** Emit a JSON payload. Only output in JSON mode. */
export function json(payload: unknown): void {
  if (!jsonMode) return;
  console.log(JSON.stringify(payload, null, 2));
}

interface DiagnosticLike {
  target: string;
  contextSource: string;
  description?: string;
  state: "valid" | "drifted";
}

/**
 * Print mapping diagnostics: green check per valid mapping, yellow warning per
 * drifted one, plus a one-line totals summary. In JSON mode emits the array.
 */
export function printDiagnostics(diags: DiagnosticLike[]): void {
  if (jsonMode) {
    json({ diagnostics: diags });
    return;
  }
  let valid = 0;
  let drifted = 0;
  for (const d of diags) {
    const desc = d.description ? pc.dim(` — ${d.description}`) : "";
    if (d.state === "valid") {
      valid++;
      console.log(`${pc.green("✓")} ${d.target}${desc} ${pc.dim(`(${d.contextSource})`)}`);
    } else {
      drifted++;
      console.log(
        `${pc.yellow("⚠")} ${pc.yellow(d.target)} — mapped in contexts.yml but ${d.target} does not exist here`,
      );
    }
  }
  console.log(pc.dim(`${diags.length} mapping(s): ${valid} valid, ${drifted} drifted`));
}

/**
 * Render a simple left-aligned table. Returns the rendered string (so it can be
 * snapshot-tested) and, unless in JSON mode, prints it.
 */
export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const pad = (cells: string[]) =>
    cells
      .map((c, i) => (c ?? "").padEnd(widths[i] ?? 0))
      .join("  ")
      .trimEnd();
  const lines = [pad(headers), pad(widths.map((w) => "-".repeat(w))), ...rows.map(pad)];
  const rendered = lines.join("\n");
  if (!jsonMode) console.log(rendered);
  return rendered;
}
