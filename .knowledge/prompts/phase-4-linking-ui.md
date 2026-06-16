# Phase 4 — Linking Engine & Interactive Add

You are implementing phase 4 of the `contexts` CLI. Read first: `docs/IMPLEMENTATION-LOG.md`, `docs/06-linking-engine.md` (entire — this is the heart of the phase), `docs/03-cli-reference.md` (§add, §interactivity rule, §UX conventions).

This is the largest phase. If needed, split at the seam: **(a)** plan+execute engine with tests, then **(b)** interactive flow wiring. Both halves below.

## Goal

`contexts add` is feature-complete except lockfile writing: interactive or flag-driven selection, real symlinks (or recorded copy fallback), conflict handling, dry-run, idempotency.

## Build — (a) engine

1. `src/core/linker.ts` per docs/06:
   - `planLinks(selections, cacheDir, projectRoot): LinkOperation[]` — pure; exact `LinkOperation` shape and classification matrix from docs/06 §Plan (lstat-based, directory-at-path → `CliError(2)`).
   - `executeLinks(ops, { force, copy, interactiveResolver }): ExecutedOp[]` — mkdir -p, remove owned existing, relative `fs.symlink(..., "file")` + readlink verification, EPERM/EACCES/ENOSYS/UNKNOWN → copy fallback with collected single end-of-run warning; resulting `mode` reflects reality. Conflict resolution delegated to an injected resolver callback (UI provides it; tests inject scripted answers). `--force` semantics incl. `.bak` backups that never overwrite (`.bak.2`, ...).
   - `pruneOrphans(oldEntries, newEntries)` — ownership-checked removal per docs/06 §Orphan pruning (used in phase 6; build + unit-test it now).
2. Unit tests: full classification matrix, deep-nesting + `"."` target relative paths, forced-EPERM fallback (monkeypatched `fs.symlink`, runs on all OSes), backup escalation, prune ownership rules.

## Build — (b) interactive flow

3. `src/ui/prompts.ts`: multiselect of valid (+drifted when `--include-drifted`) mappings showing target, description, agent source; link-name select (`AGENTS.md` / `CLAUDE.md` / both / custom input validated per docs/04 linkedAs regex); per-conflict select (backup & replace / skip / abort all). All wrappers respect the interactivity rule — non-interactive without sufficient flags → `CliError(2)` naming the missing flag.
4. Wire `commands/add.ts` end-to-end: diagnostics → selection (flags pre-empt prompts: `--target`, `--link-as`, `--copy`, `--force`, `-y` defaults = all valid targets + AGENTS.md) → plan → `--dry-run` prints the plan table and exits 0 → execute → summary table (created/replaced/skipped/copied counts + per-row detail).
5. Integration tests (docs/08 flows 1–3 minus lock assertions): add via flags creates working relative links; second identical run → all `skip-ok`, zero mutations; conflict file skipped without `--force`, backed up with it; `--copy` produces regular files; portability test (`mv` project dir, links still resolve).

## Out of scope

`contexts.lock` (phase 5 — add currently performs links without writing a lock), install/update/status/list.

## Acceptance gate

```sh
npm run lint && npm run typecheck && npm test && npm run build
# scratch project with src/components/ and src/api/:
node .../bin/contexts.js add .../contexts-basic --target '*' --link-as AGENTS.md CLAUDE.md -y
readlink src/components/AGENTS.md     # relative path into .contexts/cache/...
cat src/api/AGENTS.md                 # context content via the link
node .../bin/contexts.js add .../contexts-basic --target '*' --link-as AGENTS.md CLAUDE.md -y --dry-run   # plan only, all skip-ok
mv . ../moved-project && cat src/api/AGENTS.md   # still resolves (run equivalently)
echo "mine" > src/api/CLAUDE.md; node .../bin/contexts.js add ... -y    # skipped + warned; with --force → CLAUDE.md.bak exists
```

Append phase summary to `docs/IMPLEMENTATION-LOG.md`.
