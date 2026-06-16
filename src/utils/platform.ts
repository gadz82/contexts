/**
 * Platform/environment probes: interactivity decision and symlink capability.
 *
 * @see docs/03-cli-reference.md §Interactivity rule
 * @see docs/06-linking-engine.md §Windows specifics
 */
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** True when running under a CI environment. */
export function isCI(): boolean {
  return process.env.CI != null && process.env.CI !== "" && process.env.CI !== "false";
}

/** True when stdout is a TTY. */
export function isTTY(): boolean {
  return Boolean(process.stdout.isTTY);
}

export interface InteractivityFlags {
  yes?: boolean;
  json?: boolean;
}

/**
 * Decide whether prompts are allowed. Mirrors vercel/skills CI behavior: a
 * non-TTY, CI, `--yes`, or `--json` invocation must never prompt.
 */
export function isInteractive(flags: InteractivityFlags = {}): boolean {
  if (flags.json) return false;
  if (flags.yes) return false;
  if (isCI()) return false;
  return isTTY();
}

let symlinkCapable: boolean | undefined;

/**
 * Probe whether the filesystem allows symlink creation. Creates and removes a
 * temp symlink once; the result is cached for the process lifetime.
 */
export function canSymlink(): boolean {
  if (symlinkCapable !== undefined) return symlinkCapable;
  let dir: string | undefined;
  try {
    dir = mkdtempSync(join(tmpdir(), "contexts-symcap-"));
    const link = join(dir, "l");
    symlinkSync(join(dir, "t"), link, "file");
    symlinkCapable = true;
  } catch {
    symlinkCapable = false;
  } finally {
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }
  return symlinkCapable;
}

/** Test-only: reset the cached symlink probe. */
export function _resetSymlinkProbe(): void {
  symlinkCapable = undefined;
}
