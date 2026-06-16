/**
 * Link-name validation. A link name is a bare filename (no path segments):
 * either `*.md` with safe characters, or a dotfile like `.cursorrules`.
 *
 * @see docs/04-data-formats.md §contexts.lock (linkedAs field)
 */
const MD_RE = /^[A-Za-z0-9._-]+\.md$/;
const DOTFILE_RE = /^\.[A-Za-z0-9._-]+$/;

/** True if `name` is an allowed link filename (never a path segment). */
export function isValidLinkName(name: string): boolean {
  if (name.includes("/") || name.includes("\\")) return false;
  if (name === "." || name === "..") return false;
  return MD_RE.test(name) || DOTFILE_RE.test(name);
}

/** Default link name offered when none is specified. */
export const DEFAULT_LINK_NAME = "AGENTS.md";

/** The well-known link names offered in the interactive picker. */
export const COMMON_LINK_NAMES = ["AGENTS.md", "CLAUDE.md", "GEMINI.md"] as const;
