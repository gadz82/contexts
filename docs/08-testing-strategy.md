# 08 — Testing Strategy

Tooling: vitest. Layout mirrors `src/` (07 §layout). Tests run on ubuntu, macos, windows in CI (the windows leg is non-negotiable — symlink fallback is a core feature).

## Unit tests (`tests/unit/`)

| Module | Must-cover cases |
|---|---|
| `source.ts` | every input form in 05's table; `#ref` split; ambiguous shorthand-vs-local; subpath URLs; rejection cases (empty, absolute lock keys, local+#ref) |
| `hash.ts` | known-vector sha256; directory digest stability under file order shuffle; digest changes on rename/content change; `.git/` exclusion |
| `manifest.ts` | valid fixture parses; missing version / unknown version / empty mappings / duplicate normalized keys / `..` traversal in key and context_source / missing context_source file → each a distinct, asserted error |
| `lockfile.ts` | round-trip read/write byte-stable; sorted keys; atomic write (no partial file on injected failure); v0→v1 migration path; newer-version refusal |
| `linker.ts` (plan) | classification matrix from 06 (nothing/symlink-ours/symlink-foreign/file-owned/file-foreign/directory); relative path computation incl. deep nesting and target `"."`; orphan computation |
| `gitignore.ts` | create-if-absent; append once; idempotent re-run; recognizes both `.contexts` and `.contexts/`; warns when lock would be ignored |
| `errors.ts` | exit-code mapping table from 03 |

Pure-plan design (06) means linker planning tests need zero filesystem.

## Integration tests (`tests/integration/`)

Each test creates a disposable project dir under `os.tmpdir()` and a fixture contexts repo; remote sources are simulated with **local git repos** created in setup (`git init`, commit fixtures) — network-free, deterministic, fast. Tests invoke command functions directly (not a subprocess) with injected cwd, except two smoke tests that run the built `dist/index.js` via subprocess to validate the bin shim and bundling.

Core flows:
1. **add (local source, non-interactive flags)** → links exist, resolve into cache, lock matches 04 schema exactly, `.gitignore` updated.
2. **add idempotency** → second run: zero mutations, byte-identical lock (06 §idempotency contract).
3. **add with conflict** → pre-existing AGENTS.md: skipped without `--force`; `--force` creates `.bak` and replaces.
4. **install from lock only** → delete `.contexts/` and all links, keep lock → `install` restores everything; assert hashes verified (corrupt one cached file mid-test by re-pointing the local git repo → expect exit 4).
5. **install at pinned ref** → advance the fixture git repo by a commit after add → `install` still materializes the *old* SHA's content.
6. **update** → modify contexts repo, `update -y` → links' content updated, lock `resolvedRef`/`computedHash` bumped; removed mapping → orphan pruned; unrelated user file with same name untouched.
7. **update --check** → exit 5 when behind, 0 when current.
8. **status matrix** → fabricate each state (ok/modified/broken/missing/drifted) and assert classification + exit 5 + `--json` shape.
9. **copy mode** → `--copy`: regular files, `linkMode: "copy"` in lock; `status` validates by hash; `update` rewrites files.
10. **subpath + #ref source** → add from `tree/<ref>/<subpath>`-style local-git URL equivalent.
11. **portability** → after add, `mv` the whole project dir elsewhere → all links still resolve (relative-link proof).

## Windows-specific (CI matrix leg)

- Symlink path when Developer Mode available; forced-failure fallback: monkeypatch `fs.symlink` to throw `EPERM` → assert copy fallback + warning + `linkMode: "copy"` (this part also runs on POSIX so the fallback is always tested).
- Path normalization: lock keys POSIX on win32; links work with backslash cwd.

## Quality gates (CI, every PR)

`lint` + `typecheck` + `vitest run` green on all three OSes; integration suite < 60 s; coverage threshold: 85 % lines on `src/core/**` (UI excluded). `npm pack --dry-run` succeeds and ships only `bin`, `dist`, `README.md`.

## Manual smoke script (pre-release)

Documented in repo README: run `add` against a real private GitHub contexts repo over SSH, `install` on a second clone, `update` after a real upstream commit, `status --remote`. This is the only network-dependent verification, deliberately kept out of CI.
