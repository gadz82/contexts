/**
 * `.gitignore` management: make sure the cache is ignored, and warn if the lock
 * would accidentally be ignored.
 *
 * @see docs/06-linking-engine.md §.gitignore management
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as reporter from "../ui/reporter.js";
import { exists } from "./fs.js";

const CACHE_LINE = ".contexts/";
const COMMENT = "# contexts cache";

/**
 * Ensure `.contexts/` is ignored in the project-root `.gitignore`. Creates the
 * file if absent, appends exactly once (recognizing both `.contexts` and
 * `.contexts/`), and warns if any pattern would ignore `contexts.lock`.
 */
export async function ensureIgnored(projectRoot: string): Promise<void> {
  const gitignorePath = path.join(projectRoot, ".gitignore");
  const present = await exists(gitignorePath);
  const content = present ? readFileSync(gitignorePath, "utf8") : "";
  const lines = content.split("\n").map((l) => l.trim());

  const alreadyIgnored = lines.some((l) => l === CACHE_LINE || l === ".contexts");
  if (!alreadyIgnored) {
    const needsLeadingNewline = content.length > 0 && !content.endsWith("\n");
    const block = `${needsLeadingNewline ? "\n" : ""}${COMMENT}\n${CACHE_LINE}\n`;
    writeFileSync(gitignorePath, content + block);
  }

  // Warn (never act) if the lock would be ignored — it must stay committed.
  if (lines.some((l) => l === "contexts.lock" || l === "/contexts.lock")) {
    reporter.warn(
      "contexts.lock appears in .gitignore — it must be committed; remove that pattern",
    );
  }
}
