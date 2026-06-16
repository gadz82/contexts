# Implementation Log

Cross-session memory. Each phase appends what was built, deviations from the
spec, and TODOs for the next phase.

---

## Phase 1 — Scaffold & CLI Harness

**Built**

- Toolchain: `package.json` (5 runtime deps: commander, @clack/prompts,
  picocolors, yaml, zod), `tsconfig.json` (strict ESM, node20, Bundler
  resolution), `tsup.config.ts`, `vitest.config.ts`, `biome.json`,
  `bin/contexts.js` shebang shim.
- `src/index.ts`: commander program — version flag, five commands
  (`add <source>`, `install`, `update [targets...]`, `status`, `list`/`ls`),
  global flags `--json`/`-y`/`--dry-run`/`--verbose`, top-level handler that
  formats `CliError` and exits with the mapped code (`exitOverride` maps
  commander usage errors → exit 2, help/version → exit 0).
- `src/utils/errors.ts`: `ExitCode` table (0–5) + `CliError(exitCode, message,
  hint?)`.
- `src/utils/platform.ts`: `isCI`, `isTTY`, `isInteractive`, cached `canSymlink`
  probe.
- `src/utils/fs.ts`: `ensureDir`, `exists`, `posixify`, `atomicWrite`
  (tmp+rename) — built now, used from phase 2.
- `src/ui/reporter.ts`: intro/outro, info/warn/error/debug, aligned `table`,
  JSON-mode switch (`configureReporter`, `json`).
- `src/ui/prompts.ts`: `requireInteractive` guard, `assertNotCancelled`,
  spinner wrapper (no-op in JSON mode). Selection flows deferred to phase 4.
- `src/core/git.ts`: `assertGitAvailable()` stub only.
- `src/commands/*.ts`: polished stubs printing "not implemented (phase N)".
- `.github/workflows/ci.yml`: ubuntu/macos/windows × node20 → ci npm install,
  lint, typecheck, test, build, `npm pack --dry-run`.
- Tests: errors mapping, platform interactivity logic, reporter table snapshot.
- `AGENTS.md` (dogfood context), `README.md`.

**Deviations from docs/07**

- Global flags are registered on each subcommand (via `withCommonFlags`) rather
  than only on the root program. Reason: commander with `enablePositionalOptions`
  rejects `contexts add --json foo/bar` (flag after the command name), which is
  how users actually pass them and what the phase-1 gate exercises. Trade-off:
  `contexts --json add ...` (flag before command) is not supported; not required
  by any gate.
- `tsup` config injects a `createRequire` banner so the bundled (CJS) commander
  can `require()` node built-ins from the ESM output. Without it the single-file
  bundle throws "Dynamic require of events is not supported" at startup.
- biome chosen as the lint/format tool (allowed by docs/07). `noConsoleLog`
  enforced everywhere except `ui/reporter.ts` and tests.

**Gate** — `lint`, `typecheck`, `test` (14), `build` all green. Manual: version
prints; `add foo/bar` → notice exit 0; `nope` → exit 2; `add --json foo/bar` →
clean JSON, no banner; `npm pack --dry-run` ships only bin/dist/README
(+package.json, always included by npm).

**TODO for phase 2**

- Implement `parseSource`, extend `core/git.ts` with clone/revParse/lsRemote,
  `core/hash.ts`, `core/cache.ts`, `utils/gitignore.ts`.
- Wire `commands/add.ts` through materialization (stop before manifest parsing).
- Create `tests/fixtures/contexts-basic/`.

---

## Phase 2 — Source Resolution & Cache Engine

**Built**

- `src/core/source.ts`: `parseSource(raw, cwd)` — full docs/05 input table:
  `#ref` split first, explicit-local prefixes, ssh/`ssh://`, github URLs
  (`.git` strip, `/tree/<ref>/<subpath>`), generic https→git, shorthand
  `org/repo` with local-path disambiguation (local wins + warning), bare
  existing path → local. Rejections: empty, uninterpretable, `#ref` on local.
- `src/core/git.ts`: `clone` (shallow `--branch`, full-clone+`checkout` SHA
  fallback), `revParse`, `lsRemote`; `runGit` via `spawn` (no shell),
  `detached` process group killed on 120s timeout, `GIT_TERMINAL_PROMPT=0`,
  `GitError extends CliError` (exit 3) with stderr tail + hint.
- `src/core/hash.ts`: `hashFile` (raw bytes), `hashBytes`, `directoryDigest`
  (sorted POSIX relpaths, `\0`/`\n` framing, `.git` excluded).
- `src/core/cache.ts`: `CacheService.materialize` — clone-or-copy into a temp
  staging sibling then atomic `rename` swap; subpath extraction; `.git`/
  `node_modules` excluded on copy; `.contexts-meta.json` sidecar; manifest
  existence guard with the exact docs/05 messages. `slugForSource` per docs/05.
  `materialize` accepts a `pinnedRef` (used by install in phase 5).
- `src/utils/gitignore.ts`: `ensureIgnored` — create/append-once/idempotent,
  recognizes `.contexts` and `.contexts/`, warns if lock would be ignored.
- `commands/add.ts`: parse → spinner → materialize → "contexts cached at …
  (ref …)" → `ensureIgnored` → phase-3 notice. JSON mode emits the
  materialization summary.
- Tests: source (14), hash (7, incl. sha256 vector + digest stability),
  gitignore (4), cache integration (4: local copy + meta + digest, missing
  manifest exit 2, git clone HEAD/.git-drop/resolvedRef, re-materialize swap).
  Fixture `tests/fixtures/contexts-basic/`. Git fixtures via `initGitRepo`
  helper (network-free).

**Deviations** — none from docs/05. `CacheService.now()` is a protected method
so tests can stub timestamps later.

**Gate** — lint/typecheck/test(43)/build green. Manual: local add caches to
`local-<hash12>`, gitignore updated; bad shorthand → exit 3 with git stderr +
hint.

**TODO for phase 3** — manifest zod schema + `loadManifest` + `diagnose`;
reporter `printDiagnostics`; wire `--target`/`--include-drifted`; invalid
fixtures.

---

## Phase 3 — Manifest Parsing & Drift Diagnostics

**Built**

- `src/core/manifest.ts`: zod `RawManifestSchema`; `loadManifest(cacheDir)` —
  YAML parse → zod → version==="1" guard → ≥1 mapping → two-pass: (1) normalize
  keys + duplicate-after-normalization detection, (2) resolve+validate each
  `context_source` (relative, no `..`/absolute, traversal guard via resolved
  prefix, exists, regular file). Every failure is a distinct `CliError(2)`
  quoting the offending key/path. `diagnose(manifest, projectRoot)` →
  `{target, contextSource, description, state: valid|drifted}` (drifted = target
  dir missing). Root `"."` mapping supported.
- `src/ui/reporter.ts`: `printDiagnostics` — green ✓ valid / yellow ⚠ drifted +
  totals line; JSON mode emits `{diagnostics: [...]}`.
- `commands/add.ts`: load → diagnose → `--target` validation (unknown →
  `CliError(2)` listing available targets; `*` = all) → `computeSelectable`
  honoring `--include-drifted` → printDiagnostics → phase-4 notice.
- Fixtures: `contexts-invalid-{version,no-mappings,duplicate,traversal,
  missing-file}`, `contexts-root` (root `.` mapping).
- Tests: manifest (10) — valid parse, root mapping, 5 invalid each asserting
  exit 2 + distinct message, missing manifest, diagnose valid/drifted/root.

**Deviations** — duplicate detection moved to a first pass so it fires before
`context_source` file-existence checks (a duplicate manifest need not have valid
files). JSON-mode add emits a single payload (the diagnostics array from
`printDiagnostics`); the extra add-summary fields are deferred so output stays
valid JSON. `computeSelectable` result is computed but unused until phase 4
(`void selectable`).

**Gate** — lint/typecheck/test(53)/build green. Manual: basic add →
components valid / api drifted exit 0; invalid-version exit 2; `--target
src/nope` exit 2 listing valid targets; `--json` single valid diagnostics array.

**TODO for phase 4** — `linker.ts` plan/execute/prune; `prompts.ts` selection
flows; wire add end-to-end (no lock); consume `selectable`.

---

## Phase 4 — Linking Engine & Interactive Add

**Built**

- `src/core/linker.ts`: pure `planLinks(selections, cacheDir, projectRoot,
  {mode, known})` — lstat-based classification matrix (create / skip-ok /
  replace-link / conflict / directory→exit2), relative `relTarget`, owned
  copy-mode detection via `known` hashes. `executeLinks(ops, {copy,
  resolveConflict})` — mkdir-p, remove owned, relative `symlink(...,"file")` +
  readlink/access verify, EPERM/EACCES/ENOSYS/UNKNOWN → copyFile fallback with
  one end-of-run warning; injected `resolveConflict` callback; `.bak`/`.bak.N`
  backups never overwritten. `pruneOrphans(old, new, root, cacheRoot)` —
  ownership-checked removal (symlink into cache OR file hashing to old lock
  hash), foreign files kept + warned. `_setSymlinkImpl` test seam for the
  EPERM-fallback test (ESM named imports can't be spied).
- `src/utils/linkname.ts`: `isValidLinkName` (`*.md` or dotfile, no path
  segments), `DEFAULT_LINK_NAME`, `COMMON_LINK_NAMES`.
- `src/ui/prompts.ts`: `selectMappings`, `selectLinkNames` (validated),
  `resolveConflictPrompt`.
- `commands/add.ts` end-to-end: diagnostics → target selection (flags →
  prompt → non-interactive default = all selectable) → link-name selection
  (`--link-as` → prompt → AGENTS.md) → plan → `--dry-run` prints plan table →
  execute → summary table + counts. Conflict policy: `--force`→backup,
  interactive→prompt, else→skip.
- Tests: linker unit (classification matrix incl. deep nesting + "." target,
  symlink create, EPERM copy fallback, conflict skip/backup escalation, prune
  ownership). add integration (relative links + gitignore, idempotency, conflict
  skip/force, --copy regular files, portability after `mv`, drifted-only links
  nothing).

**Deviations** — non-interactive add without `--target` defaults to all
selectable mappings + AGENTS.md (rather than erroring), since both choices have
sensible defaults; matches the spec's "-y defaults" and keeps CI usable. Lock
writing intentionally absent (phase 5) — re-running add re-links idempotently
but does not yet persist state.

**Gate** — lint/typecheck/test(70)/build green. Manual: `--target '*' --link-as
AGENTS.md CLAUDE.md -y` creates 4 relative symlinks resolving into the cache;
dry-run all skip-ok; conflict skipped (file preserved) without --force; --force
writes `.bak` and replaces with a symlink.

**TODO for phase 5** — `lockfile.ts` (zod, read/write/merge, atomic sorted);
build lock entries from executed reality in add; `install.ts` restore-from-lock.

---

## Phase 5 — Lockfile & install

**Built**

- `src/core/lockfile.ts`: zod `LockFileSchema`/`LockEntrySchema` (sourceType
  enum, resolvedRef nullable, linkedAs nonempty+unique+valid-names, linkMode
  enum, sha256 hex). `readLock` (absent→null, bad JSON/schema→exit4, newer
  version→exit4 "upgrade"), `writeLock` (atomic, `stableStringify` recursive
  key sort + trailing newline), `mergeEntries` (reconcile by target, no dups).
- `commands/add.ts`: after execute, `buildLockEntries` from owned ops (one entry
  per target, real linkedAs/linkMode, `computedHash` of the cached file) →
  `mergeEntries` → `writeLock`. Summary says "contexts.lock updated (N entries)".
- `commands/install.ts`: read lock (missing→exit4 message); group by source,
  materialize once at pinned `resolvedRef` (`pinnedRef`); verify every entry's
  contextPath hash vs `computedHash`, collect all mismatches → exit4 listing
  `target: expected ≠ actual`, or `--force` re-pins lock to fetched reality;
  rebuild links idempotently via the phase-4 engine honoring `linkMode`, no
  prompts (foreign conflicts skipped+warned). `resolvedFromLock` reconstructs a
  ResolvedSource per sourceType.
- `src/core/source.ts`: `file://` URLs now classify as `git` (enables
  network-free testing of the remote fetch/pin path with a local git repo, and
  is a valid real git transport).
- Tests: lockfile unit (round-trip byte-stable, sorted keys, null/invalid-JSON/
  schema/newer-version, mergeEntries, stableStringify); install integration
  (lock contract shape, restore-from-lock-only, idempotency, hash-mismatch
  exit4, --force re-pin, pinned-SHA survives upstream advance, missing-lock
  exit4).

**Deviations / gaps** — the lock schema (docs/04) has no `subpath` field, so an
install of a github/git source that used a `/tree/<ref>/<subpath>` URL cannot
reproduce the subpath extraction (slug + contextPath assume the subpath was the
cache root). Flagged for phase 7: either extend the schema + doc, or document
the limitation. Non-subpath sources (the common case) reproduce exactly.

**Gate** — lint/typecheck/test(85)/build green. Manual: add via `file://` git
repo writes a docs/04-shaped lock (sorted keys, sha, resolvedRef); `rm -rf
.contexts src/*/AGENTS.md` then install restores + resolves; second install
"verified"; `rm contexts.lock` → install exit 4.

**TODO for phase 6** — `status` (state matrix + --remote + exit5), `list`,
`update` (diff/apply/re-pin + pruneOrphans + --check). Decide subpath gap.

---

## Phase 6 — update, status, list

**Built**

- `commands/list.ts`: lock-only table (target, linked as, mode, source, short
  ref, short hash); `--json`; empty lock → friendly notice exit 0.
- `commands/status.ts`: per (target × linkName) disk classification — ok /
  modified / broken / missing / drifted (recomputed from disk, sidecar ignored);
  `--remote` adds `stale` via `lsRemote` vs `resolvedRef` (network failure →
  warn, not error); table + per-state fix lines; `--json {entries}`; exit 0
  clean / exit 5 (`process.exitCode`) on any non-ok.
- `commands/update.ts`: optional `[targets...]` filter (unknown → exit 2 listing
  lock targets); per source change detection (git `lsRemote` HEAD vs ref; local
  `directoryDigest` vs meta sidecar); `--check` → exit 5 behind / 0 current, no
  mutation; else re-materialize changed sources, diff table (old→new short hash),
  confirm (skipped with `-y`; non-interactive proceeds), re-link changed entries,
  refresh `resolvedRef`+`computedHash`, write lock; orphan mappings (gone from
  the new manifest, or file vanished) pruned via `pruneOrphans` (ownership-safe);
  new upstream mappings surfaced as "available via contexts add".
- Tests: status state matrix (ok/modified/broken/missing/drifted + exit codes
  via JSON capture); update list-rows, --check exit 5/0, apply+re-pin, prune
  removed mapping while preserving a hand-edited foreign file.

**Deviations** — orphan detection keys on the new manifest's target set (a
removed *mapping* leaves its source file in the repo, so file-existence alone
wouldn't catch it) plus file-vanished. `update` confirmation auto-proceeds in
non-interactive sessions without `-y` (can't prompt; running update is an
explicit intent); CI should use `--check`.

**Gate** — lint/typecheck/test(95)/build green. Manual: list table matches
lock; status all-ok exit 0; cache removed → broken + "run contexts install"
exit 5; update --check exit 5 behind; update -y applies + re-pins (diff shown);
status exit 0 after; update --check exit 0 current.

**TODO for phase 7** — test-matrix completion (subprocess smoke, subpath+ref,
hostile names, coverage gate), invariant audit, windows leg, error catalog,
README + RELEASE.md, packaging. Resolve the subpath-in-lock gap (phase 5 note).

---

## Phase 7 — Hardening, Cross-Platform & Release Prep

**Built**

- **Subpath gap closed** (phase-5 TODO): lock schema gained an optional
  `subpath` field; `add` records it, `install`/`update` reconstruct it so a
  `/tree/<ref>/<subpath>` source reproduces its cache layout + contextPath
  exactly. `docs/04-data-formats.md` updated (field-contract table).
- **Test-matrix completion** (now 125 tests, 19 files):
  - `tests/integration/smoke.test.ts`: subprocess runs of the built
    `dist/index.js` via the bin shim — happy path (`--version` → 0), error paths
    (unknown command → 2, install w/o lock → 4). Builds the bundle if absent.
  - `tests/integration/subpath.test.ts`: cache materializes only the subpath as
    its root; bad subpath → exit 2. Fixture `contexts-subpath/`.
  - `tests/integration/robustness.test.ts`: CRLF content hashes identically
    through the cache copy (no EOL normalization); hostile target names (spaces)
    + a pre-existing dead symlink don't break add/status.
  - `tests/unit/git.test.ts`: clone/revParse/lsRemote happy + failure (exit 3)
    paths, SHA-checkout fallback — lifted git.ts coverage.
  - `tests/unit/manifest.test.ts`: added invalid-YAML, absolute key, absolute
    context_source, dir-not-file, schema-error cases.
  - `tests/unit/exitcodes.test.ts`: parametrized exit-code catalog + uniqueness.
  - Coverage gate (85% lines on `src/core/**`) wired in `vitest.config.ts` via
    `@vitest/coverage-v8`; now **88.29%** lines overall, every core file ≥ 85%
    except none below the global gate.
- **Windows leg**: paths normalized through `path`/`posixify`; lock keys POSIX;
  copy-fallback proven on all OSes via the `_setSymlinkImpl` EPERM seam; CRLF
  safety test. CI matrix (ubuntu/macos/windows) runs lint+typecheck+test+build+
  `npm pack --dry-run`.
- **UX/verbose**: `--verbose` traces each git invocation and dumps git stderr on
  non-zero exit (`reporter.debug`); all CliError sites carry an actionable hint.
- **Docs/packaging**: end-user `README.md` (quickstart, source forms, authoring
  guide, CI recipe, Windows + local-source caveats, exit codes); `docs/RELEASE.md`
  checklist. `npm pack` ships only `bin/`, `dist/`, `README.md` (+package.json);
  install-from-tarball runs `contexts --version` (verified locally). License field
  left for the release step (repo private; publishing deferred + gated).

**Invariant audit** (docs/02 §Invariants → proof):
- *Writes only target/.contexts/lock/.gitignore* — exercised by add/install/
  update integration; gitignore append-only single-line in `gitignore.test`.
- *Never deletes a file it doesn't own* — `linker.test` prune ownership +
  `update.test` "preserves a hand-edited foreign file".
- *Lock written atomically, sorted, trailing newline* — `lockfile.test`
  byte-stable round trip.
- *Cache reproducible (deleting .contexts is safe)* — `install.test` restore
  from lock alone.

**Deviations / open risks**

- Full CLI add→install **subpath** flow is covered at the cache/lock layer, not
  end-to-end through `add`, because `parseSource` only extracts a subpath from
  `github.com /tree/` URLs (a network host); the local-git test rig can't supply
  one. The mechanism (cache extraction + lock round-trip + reconstruction) is
  tested directly.
- The manual network smoke (real private repo over SSH) is documented in
  `docs/RELEASE.md` and intentionally not run in CI / not run here (no creds).
- `dist/index.js` ≈ 600 KB, dominated by the `yaml` dependency; acceptable for a
  bundled CLI, candidate for trimming if cold-start matters.

## Release readiness

- **Status**: feature-complete for v1. All five commands implemented; gates
  (lint/typecheck/125 tests/build/pack) green locally.
- **Before publish**: add a LICENSE, run the CI matrix (esp. the windows leg),
  perform the manual SSH smoke, choose a scoped package name (see RELEASE.md).
- **v1.1 candidates** (docs/02 §Future): `remove` + `init` commands, glob targets
  in contexts.yml, content templating/variables, multi-file profile bundles,
  a strict `check --ci` mode beyond `status --json`.

---

## Post-v1 — Context tags (`--tag`)

**Built**

- **Schema**: optional top-level `tags:` block in contexts.yml — each named tag
  has its own `mappings:` record (same shape + validation as root). Effective
  mappings for a tag = root layered with the tag (override matching targets, add
  new ones; tag wins). `manifest.ts`: `RawTagSchema`, `parseMappings` extracted
  + reused, `resolveMappings(manifest, tag?)` (unknown tag → exit 2 listing
  available; empty-tag → exit 2), `diagnose` takes an optional tag.
- **Lock**: optional `tag` field per entry (omitted when null) so `install`
  reproduces the variant and `update` re-resolves it. docs/04 updated.
- **add**: `--tag <name>` → validates + resolves effective mappings, diagnoses/
  selects/links under the tag, records `tag` in each entry.
- **update**: `--tag <name>` re-resolves each considered entry under the tag and
  re-pins it; an explicit `--tag` forces re-resolution even when upstream is
  unchanged (so it switches context); with no `--tag` each entry keeps its
  recorded tag. Orphan detection now keys on the tag's effective target set, and
  the entry's `contextPath` is refreshed if the tag points at a different file.
- **CLI**: `--tag <name>` registered on `add` and `update`.
- Tests: manifest unit (load tags, resolve no-tag/override+add, unknown tag,
  empty tag); `tags.test.ts` integration (default root, `--tag` override+add+
  lock-record, unknown tag exit 2, `update --tag` switch, `update` keeps tag).
  Fixture `contexts-tags/`.

**--force confirmation** (re-verified, unchanged): conflicting regular file +
`--force` → `<name>.bak` backup (escalating `.bak.N`, never overwritten) then
replace with the link; no `--force` non-interactive → skip + warn, file
untouched, exit 0; interactive → prompt. Covered by `add.test`/`linker.test`.

**Gate** — lint/typecheck/test(135)/build/pack green; coverage 88.71% lines on
`src/core/**`. Manual: default links root; `--tag experimental` overrides
src/api + adds src/docs + records tag in lock; unknown tag → exit 2.

**Note** — re-adding `add --tag <other>` overwrites entries for the targets it
touches but does not prune entries from a previous tag that the new tag no longer
includes (add is additive); use `update --tag <other>` to switch in place. Full
prune-on-tag-switch is a candidate refinement.
