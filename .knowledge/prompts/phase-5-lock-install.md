# Phase 5 — Lockfile & `install`

You are implementing phase 5 of the `contexts` CLI. Read first: `docs/IMPLEMENTATION-LOG.md`, `docs/04-data-formats.md` (§contexts.lock — the field contract is exact), `docs/03-cli-reference.md` (§install), `docs/02-architecture.md` (§pillar 2, §pipelines install).

## Goal

`add` records deterministic state; `install` reproduces it from the lock alone — the `npm ci` moment that makes the tool trustworthy.

## Build

1. `src/core/lockfile.ts`:
   - zod schema mirroring docs/04 §contexts.lock exactly (entry fields, linkedAs regex, sourceType enum, linkMode enum, sha256 hex pattern, resolvedRef nullable).
   - `readLock(projectRoot)`: missing → null; unparseable/schema-invalid → `CliError(4)`; `version` newer than supported → `CliError(4, "...upgrade contexts")`.
   - `writeLock(projectRoot, lock)`: sorted keys recursively, 2-space indent, trailing newline, atomic (tmp + rename). Byte-stable round trip is a unit-tested property.
   - `mergeEntries(existing, newEntries)`: re-adding a source reconciles (replace entries for same target), never duplicates.
2. Finish `commands/add.ts`: after executed links, build entries from reality — `source`/`sourceType` from the resolver canonical form, `resolvedRef` from materialization, `contextPath` POSIX, `linkedAs` actually created names, `linkMode` actually used mode, `computedHash` = hash of the cached file — merge + write lock. Summary now mentions "contexts.lock updated (N entries)".
3. `commands/install.ts` per docs/03 §install and docs/02 pipeline:
   - read lock (missing → exit 4 with the specified message);
   - group entries by source; materialize each once — github/git at exactly `resolvedRef` (checkout SHA; fetch failure → exit 3), local by copy;
   - verify every entry's `contextPath` hash against `computedHash`; collect all mismatches and fail exit 4 listing `target: expected ≠ actual` (unless `--force`: re-pin lock to fetched reality with prominent warning);
   - rebuild links idempotently via the phase-4 engine honoring each entry's `linkMode` (no prompts ever; contexts-owned paths overwritten silently, foreign conflicting files → warning + skip, never exit-blocking);
   - summary: restored/verified/skipped counts.
4. Integration tests (docs/08 flows 1, 2, 4, 5): lock written by add matches the docs/04 example shape byte-conventions; delete `.contexts/` + all links → `install` fully restores; tamper upstream content vs lock → exit 4; advance fixture git repo after add → `install` still materializes the pinned SHA's content; install idempotency (second run zero mutations).

## Out of scope

`update`, `status`, `list`; lock migrations beyond the version guard.

## Acceptance gate

```sh
npm run lint && npm run typecheck && npm test && npm run build
# scratch project:
node .../bin/contexts.js add <local git fixture repo> --target '*' --link-as AGENTS.md -y
cat contexts.lock                       # matches docs/04 contract: sorted keys, sha, resolvedRef
rm -rf .contexts src/*/AGENTS.md
node .../bin/contexts.js install   # everything restored; readlink resolves; exit 0
node .../bin/contexts.js install   # idempotent, "verified" summary
rm contexts.lock && node .../bin/contexts.js install; echo $?   # exit 4, actionable message
```

Append phase summary to `docs/IMPLEMENTATION-LOG.md`.
