# 03 — CLI Reference

Binary name: `contexts`. Invoked as `npx contexts <command>`. All commands run relative to `process.cwd()` (assumed project root; if no `contexts.lock` and no `.git` found, warn but proceed).

Global flags: `--json` (machine-readable output, implies no prompts), `--yes/-y` (accept defaults, skip confirmations), `--dry-run` (plan and print, mutate nothing), `--verbose`.

Interactivity rule (mirrors vercel/skills CI behavior): if stdout is not a TTY, or `CI` env var is set, or `--yes`/`--json` given → never prompt; missing required choices become errors (exit 2) telling the user which flag to pass.

---

## `contexts add <source>`

Fetch a contexts repo, select mappings, create links, write lock.

```sh
npx contexts add your-org/engineering-contexts
npx contexts add https://github.com/your-org/engineering-contexts/tree/main#v2   # ref pin
npx contexts add ../shared-contexts --target src/api --link-as AGENTS.md CLAUDE.md -y
```

| Flag | Description |
|---|---|
| `--target <paths...>` | Pre-select mappings by target path (skip multiselect). `'*'` = all valid mappings. |
| `--link-as <names...>` | Link filenames: any of `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, or arbitrary `*.md`. Default prompt offers AGENTS.md / CLAUDE.md / both. |
| `--copy` | Force copy mode instead of symlinks (recorded as `linkMode: "copy"`). |
| `--force` | Overwrite pre-existing regular files at link paths without prompting (a `.bak` backup is still written). |
| `--include-drifted` | Offer drifted mappings too; selecting one creates the missing target directory. |
| `--tag <name>` | Use a named context tag from `contexts.yml` (overrides/extends root mappings). Unknown tag → exit 2 listing available tags. Recorded per lock entry. |

Behavior detail:
- Re-adding the same source = upgrade/repair: existing lock entries for that source are reconciled, not duplicated.
- Conflict at link path (regular file exists): interactive → prompt `[backup & replace / skip / abort]`; non-interactive without `--force` → skip with warning and exit 0 but report; with `--force` → backup to `<name>.bak` then replace.
- After success: ensure `.contexts/` is in `.gitignore` (create file if absent, append once, never duplicate).

## `contexts install`

Headless restore from `contexts.lock` — the `npm ci` equivalent. No flags besides globals and `--force`.

- Missing lock → exit 4 with message "no contexts.lock found — run `contexts add <source>` first".
- Hash mismatch between fetched file and `computedHash` → exit 4 listing each `target: expected≠actual` (unless `--force`, which re-pins the lock to fetched content with a warning).
- Existing correct links are left untouched (idempotent); wrong/missing ones rebuilt.
- For `sourceType: "github"|"git"`, fetch at `resolvedRef` exactly (clone + checkout SHA). For `"local"`, copy current directory state and verify hashes (local sources cannot time-travel; document this).

## `contexts update [targets...]`

Fetch upstream, diff, apply, re-pin.

```sh
npx contexts update              # all sources, confirm before applying
npx contexts update src/api -y   # only entries whose target matches
```

| Flag | Description |
|---|---|
| `--check` | Exit 0 if up-to-date, exit 5 if updates available; apply nothing. For CI. |
| `--tag <name>` | Re-resolve entries under this tag (switches context even when upstream is unchanged) and re-pin the recorded tag. With no `--tag`, each entry keeps its recorded tag. |

Output per source: `up-to-date` or a per-entry diff table (`target / old hash → new hash / changed?`). Mappings removed upstream → prompt to unlink + drop from lock (auto-confirm with `-y`). New mappings upstream → mentioned as available via `add`, never auto-installed.

## `contexts status`

Recompute truth from disk. Read-only, exit 0 unless problems found (then exit 5; CI-friendly).

Entry states:

| State | Meaning | Detection |
|---|---|---|
| `ok` | Link resolves to cached file, hash matches lock | readlink + sha256 |
| `modified` | Content at link path differs from lock hash (hand-edited copy, or replaced file) | sha256 mismatch |
| `broken` | Symlink exists but target missing (cache deleted) | failed resolve |
| `missing` | Lock entry has no file/link on disk | lstat fails |
| `drifted` | Target directory itself no longer exists | dir lstat fails |
| `stale` | Upstream has newer ref (only with `--remote`) | ls-remote vs resolvedRef |

`--remote` adds the upstream check (network). `--json` emits `{entries: [{target, state, linkMode, ...}]}` for CI pipelines. Suggested fixes printed per state (`run contexts install`, `run contexts update`, ...).

## `contexts list` (alias `ls`)

Pretty table straight from the lock: target, link names, link mode, source, short ref, short hash. `--json` for scripts. No disk inspection (that's `status`).

---

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Unexpected error (bug, IO) |
| 2 | Usage/validation error (bad flags, invalid contexts.yml, missing non-interactive choices) |
| 3 | Source fetch failure (network, auth, bad ref, git missing) |
| 4 | Lock integrity failure (missing, unparseable, hash mismatch) |
| 5 | Status/check findings (status problems, update --check has updates) |

## UX conventions

clack intro/outro banners (`◆ contexts vX.Y.Z`), spinners for network steps, summary table at end of every mutating command, warnings in yellow / errors in red via picocolors, every error message ends with one actionable next step. `--json` suppresses all decoration and prompts.
