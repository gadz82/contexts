/**
 * commander program: registers the five commands + global flags, wires the
 * single top-level error handler that formats `CliError` and exits with the
 * mapped code.
 *
 * @see docs/03-cli-reference.md
 */
import { readFileSync } from "node:fs";
import { Command, CommanderError } from "commander";
import { addCommand } from "./commands/add.js";
import { installCommand } from "./commands/install.js";
import { listCommand } from "./commands/list.js";
import { statusCommand } from "./commands/status.js";
import { updateCommand } from "./commands/update.js";
import * as reporter from "./ui/reporter.js";
import { CliError, ExitCode } from "./utils/errors.js";

interface GlobalOpts {
  json?: boolean;
  yes?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
}

function readVersion(): string {
  try {
    const pkgUrl = new URL("../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(pkgUrl, "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Read command flags, configure the reporter, print the intro banner, and hand
 * the body a single options object.
 */
function withGlobals<T extends GlobalOpts>(cmd: Command): T {
  const opts = cmd.opts() as T;
  reporter.configureReporter({ json: opts.json, verbose: opts.verbose });
  reporter.intro(readVersion());
  return opts;
}

/**
 * The four global flags are attached to every subcommand so they work after the
 * command name (`contexts add --json ...`), which is how users invoke them.
 */
function withCommonFlags(cmd: Command): Command {
  return cmd
    .option("--json", "machine-readable output, implies no prompts")
    .option("-y, --yes", "accept defaults, skip confirmations")
    .option("--dry-run", "plan and print, mutate nothing")
    .option("--verbose", "verbose diagnostics");
}

function buildProgram(): Command {
  const program = new Command();
  program
    .name("contexts")
    .description("Deterministic context package manager for AI agent profiles")
    .version(readVersion(), "-V, --version", "print version")
    .showHelpAfterError();

  withCommonFlags(program.command("add"))
    .argument("<source>", "contexts repo: org/repo, URL, git URL, or local path (optionally #ref)")
    .description("fetch a contexts repo, select mappings, create links, write lock")
    .option("--target <paths...>", "pre-select mappings by target path ('*' = all valid)")
    .option("--link-as <names...>", "link filenames (AGENTS.md, CLAUDE.md, ...)")
    .option("--copy", "force copy mode instead of symlinks")
    .option("--force", "overwrite pre-existing regular files at link paths (writes .bak)")
    .option("--include-drifted", "offer drifted mappings too, creating missing target dirs")
    .option("--tag <name>", "use a named context tag (overrides/extends the root mappings)")
    .action(async (source: string, _o, cmd: Command) => {
      await addCommand(source, withGlobals(cmd));
    });

  withCommonFlags(program.command("install"))
    .description("headless restore from contexts.lock (npm ci equivalent)")
    .option("--force", "re-pin lock to fetched content on hash mismatch")
    .action(async (_o, cmd: Command) => {
      await installCommand(withGlobals(cmd));
    });

  withCommonFlags(program.command("update"))
    .argument("[targets...]", "only update entries whose target matches")
    .description("fetch upstream, diff, apply, re-pin")
    .option("--check", "exit 0 if up-to-date, 5 if updates available; apply nothing")
    .option(
      "--tag <name>",
      "switch to a named context tag when re-resolving ('default' = back to root)",
    )
    .action(async (targets: string[], _o, cmd: Command) => {
      await updateCommand(targets, withGlobals(cmd));
    });

  withCommonFlags(program.command("status"))
    .description("recompute per-entry truth from disk")
    .option("--remote", "also check upstream for newer refs (network)")
    .action(async (_o, cmd: Command) => {
      await statusCommand(withGlobals(cmd));
    });

  withCommonFlags(program.command("list"))
    .alias("ls")
    .description("pretty table straight from the lock")
    .action(async (_o, cmd: Command) => {
      await listCommand(withGlobals(cmd));
    });

  return program;
}

async function main(): Promise<void> {
  const program = buildProgram();
  program.exitOverride();
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    if (err instanceof CommanderError) {
      // Help/version already printed their content; exit 0 for those, else 2.
      const benign = err.code === "commander.helpDisplayed" || err.code === "commander.version";
      process.exit(benign ? ExitCode.Success : ExitCode.Usage);
    }
    throw err;
  }
}

main().catch((err: unknown) => {
  if (err instanceof CliError) {
    reporter.error(err.message, err.hint);
    process.exit(err.exitCode);
  }
  // Unexpected: exit 1, stack only under --verbose.
  const message = err instanceof Error ? err.message : String(err);
  reporter.error(`unexpected error: ${message}`, "this is likely a bug in contexts");
  if (reporter.isVerbose() && err instanceof Error && err.stack) {
    process.stderr.write(`${err.stack}\n`);
  }
  process.exit(ExitCode.Unexpected);
});
