# Phase 2 — Source Resolution & Cache Engine

You are implementing phase 2 of the `contexts` CLI. Read first: `docs/IMPLEMENTATION-LOG.md`, `docs/05-source-resolution.md` (entire), `docs/04-data-formats.md` (§Hashing rules, §.contexts-meta.json), `docs/06-linking-engine.md` (§.gitignore management only), `docs/02-architecture.md` (§pillar 1).

## Goal

Given any accepted source string, `contexts` can materialize that source into `.contexts/cache/<slug>/` with a correct meta sidecar — wired into the `add` command up to (and excluding) manifest parsing.

## Build

1. `src/core/source.ts`: `parseSource(raw, cwd): ResolvedSource` implementing the full input-form table in docs/05, including `#ref` splitting, `/tree/<ref>/<subpath>` URLs, shorthand-vs-local disambiguation, and every rejection case as `CliError(2|3, ...)` with the exact messages specified.
2. `src/core/git.ts`: extend the phase-1 stub with `clone(opts)`, `revParse(dir)`, `lsRemote(url, ref?)` built on `child_process.spawn` (never a shell string): timeout 120 s, kill process group on timeout, capture stderr, wrap failures in `GitError extends CliError` (exit 3) including git's stderr tail and a hint. SHA-ref clone fallback per docs/05.
3. `src/core/hash.ts`: `hashFile(path)` and `directoryDigest(dir, {exclude})` exactly per docs/04 §Hashing (raw bytes, sorted POSIX relpaths, `\0`/`\n` framing, `.git/` excluded).
4. `src/core/cache.ts`: `CacheService` with `materialize(resolved): { cacheDir, resolvedRef, directoryDigest }` — clone-or-copy into a temp sibling then atomic swap into `.contexts/cache/<slug>/`, write `.contexts-meta.json`, subpath extraction, `contexts.yml`-exists guard (exit 2 with the message in docs/05 §Validation). Slugging exactly per docs/05.
5. `src/utils/gitignore.ts`: `ensureIgnored(projectRoot)` per docs/06 §gitignore (idempotent append, create-if-absent, lock-ignored warning).
6. Wire `commands/add.ts`: parse source → spinner → materialize → print "contexts cached at <relative path> (ref <short-sha>)" → call `ensureIgnored` → stop with "manifest handling lands in phase 3" notice.
7. Tests per `docs/08-testing-strategy.md` rows for `source.ts`, `hash.ts`, `gitignore.ts`, plus cache integration tests using a local fixture contexts repo **and** a local `git init` fixture repo (create `tests/fixtures/contexts-basic/` now: `contexts.yml` with 2 mappings + matching agent files). No network in any test.

## Out of scope

contexts.yml parsing/validation (only existence is checked), linking, lockfile, update/status/list logic.

## Acceptance gate

```sh
npm run lint && npm run typecheck && npm test && npm run build
# in a scratch dir outside the repo:
node /path/to/contexts/bin/contexts.js add /path/to/contexts/tests/fixtures/contexts-basic
ls .contexts/cache/                      # local-<hash12> dir with repo contents + .contexts-meta.json
cat .gitignore                              # contains .contexts/
node /path/to/contexts/bin/contexts.js add definitely/not-a-repo-xyz; echo $?   # exit 3, git stderr surfaced, hint shown
```

Append phase summary to `docs/IMPLEMENTATION-LOG.md`.
