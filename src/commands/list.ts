/**
 * `contexts list` (alias `ls`) — pretty table straight from the lock. No disk
 * inspection (that's `status`).
 *
 * @see docs/03-cli-reference.md §list
 */
import { readLock } from "../core/lockfile.js";
import * as reporter from "../ui/reporter.js";

export interface ListOptions {
  json?: boolean;
  yes?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
}

export async function listCommand(_opts: ListOptions): Promise<void> {
  const cwd = process.cwd();
  const lock = await readLock(cwd);

  const entries = lock ? Object.entries(lock.contexts) : [];
  if (entries.length === 0) {
    reporter.info("no contexts installed — run `contexts add <source>`");
    reporter.json({ command: "list", entries: [] });
    return;
  }

  if (reporter.isJsonMode()) {
    reporter.json({
      command: "list",
      entries: entries.map(([target, e]) => ({ target, ...e })),
    });
    return;
  }

  reporter.table(
    ["target", "linked as", "mode", "source", "ref", "hash"],
    entries.map(([target, e]) => [
      target,
      e.linkedAs.join(", "),
      e.linkMode,
      e.source,
      e.resolvedRef ? e.resolvedRef.slice(0, 7) : "—",
      e.computedHash.slice(0, 7),
    ]),
  );
}
