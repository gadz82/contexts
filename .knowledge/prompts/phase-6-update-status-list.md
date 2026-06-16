# Phase 6 — `update`, `status`, `list`

You are implementing phase 6 of the `contexts` CLI. Read first: `docs/IMPLEMENTATION-LOG.md`, `docs/03-cli-reference.md` (§update, §status, §list, §exit codes), `docs/06-linking-engine.md` (§Orphan pruning), `docs/04-data-formats.md` (§directory digest, §.contexts-meta.json).

## Goal

The day-2 story: see truthful state, pull upstream changes safely, never destroy user content.

## Build

1. `commands/status.ts`:
   - For every lock entry × linkName, classify per the docs/03 state table — implement detection exactly: `ok` (symlink resolves into cache + cache-file hash matches lock; copy-mode: file hash matches), `modified`, `broken`, `missing`, `drifted`. Recompute from disk; never trust the meta sidecar.
   - `--remote`: per unique source, `git ls-remote` (or local directory digest) vs lock `resolvedRef`/meta digest → mark entries `stale`. Network failures degrade to a warning, not an error.
   - Output: table (target, links, mode, state colored) + per-state suggested fix lines; `--json` per docs/03; exit 0 clean / 5 when any non-ok state.
2. `commands/list.ts`: lock-only pretty table (target, linkedAs, linkMode, source, short ref, short hash) + `--json`; empty lock → friendly notice, exit 0.
3. `commands/update.ts` per docs/03 §update and docs/02 pipeline:
   - Optional positional `[targets...]` filter (unknown target → exit 2 listing lock targets).
   - Per source: fetch upstream HEAD / recompute local digest; unchanged → "up-to-date". Changed → materialize to a staging cache dir, compute per-entry new hashes, print diff table (target / old→new short hashes / changed flag).
   - Confirm before applying (skipped with `-y`); apply = swap cache, re-link changed entries, refresh `resolvedRef` + `computedHash`, write lock.
   - Mappings whose `contextPath` vanished upstream → confirm unlink + lock removal, executed through `pruneOrphans` (ownership rules — hand-modified files are warned about and left alone). New upstream mappings → informational "available via contexts add" line.
   - `--check`: no mutations; exit 5 if anything is behind, else 0.
4. Integration tests (docs/08 flows 6–9): update applies upstream commit and re-pins; removed mapping pruned but hand-edited file preserved; `--check` exit codes; full status state matrix fabricated and asserted incl. `--json` shape and exit 5; copy-mode status/update behavior.

## Out of scope

`remove`/`init` commands, glob mappings, packaging polish (phase 7).

## Acceptance gate

```sh
npm run lint && npm run typecheck && npm test && npm run build
# scratch project with installed contexts from a local git fixture:
node .../bin/contexts.js list                     # table matches lock
node .../bin/contexts.js status; echo $?          # all ok, exit 0
rm -rf .contexts && node .../bin/contexts.js status; echo $?    # broken entries, fix hint "run contexts install", exit 5
node .../bin/contexts.js install
# commit a change to the fixture contexts repo, then:
node .../bin/contexts.js update --check; echo $?  # exit 5
node .../bin/contexts.js update -y                # diff shown, applied; status exit 0; lock ref bumped
node .../bin/contexts.js update --check; echo $?  # exit 0
```

Append phase summary to `docs/IMPLEMENTATION-LOG.md`.
