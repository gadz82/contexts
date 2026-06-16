# 02 — System Architecture

## Topology

```text
+--------------------------+
|  Contexts Repo (source)     |   github: org/engineering-contexts
|  ├── contexts.yml           |   git:    git@host:org/contexts.git
|  └── agents/             |   local:  ../shared-contexts/
|      ├── frontend/AGENTS.md
|      └── backend/AGENTS.md
+--------------------------+
            │  add / install / update  (shallow clone or recursive copy)
            ▼
+---------------------------------------------------------------+
| Consumer Project Root                                          |
|                                                                |
|  .contexts/                          (git-ignored)          |
|  └── cache/                                                    |
|      └── github-your-org-engineering-contexts/   ← source slug     |
|          ├── .contexts-meta.json           ← resolvedRef, fetchedAt|
|          ├── contexts.yml                                          |
|          └── agents/frontend/AGENTS.md  ← canonical copy        |
|                          ▲                                      |
|            relative symlinks (../../.contexts/cache/...)     |
|                          │                                      |
|  src/components/AGENTS.md    src/components/CLAUDE.md           |
|  src/api/AGENTS.md                                              |
|                                                                |
|  contexts.lock                            (committed)             |
+---------------------------------------------------------------+
```

## Core pillars

### 1. Content-addressed persistent cache

Symlinks need a stable local source, so every contexts source is materialized under `.contexts/cache/<source-slug>/`. The slug is deterministic per source (see 05-source-resolution §Slugging) so multiple contexts sources can coexist in one project without collision. Each cache dir carries a `.contexts-meta.json` sidecar (`source`, `sourceType`, `resolvedRef`, `fetchedAt`) used by `update`/`status`; it is *informational only* — the lock, not the sidecar, is authoritative.

### 2. Self-contained deterministic lock

`contexts.lock` entries each record `source`, `sourceType`, `resolvedRef` (commit SHA for git sources), `contextPath`, `linkedAs`, `linkMode`, and `computedHash`. `install` reads only the lock: fetch source at `resolvedRef`, verify each file's SHA-256 against `computedHash`, rebuild links. No `contexts.yml` lookup at restore time — the manifest is a *discovery/UX* artifact for `add`, never a runtime dependency. Full schema in 04-data-formats.

### 3. Relative symlinks, recorded fallback

Links are computed with `path.relative(path.dirname(linkPath), cachedFile)` so the project is position-independent on disk. When symlinking fails (Windows without Developer Mode, restricted FS), the engine falls back to a file copy, warns prominently, and records `linkMode: "copy"` in the lock so `status` and `update` treat that entry by hash comparison instead of link inspection. Details in 06-linking-engine.

### 4. Honest, inspectable state

Every mutating command ends with a summary table; `status` recomputes truth from disk (link target resolution + content hashes) rather than trusting the lock blindly. State definitions in 03-cli-reference §status.

## Component responsibilities

| Component | Module (see 07) | Responsibility |
|---|---|---|
| Source resolver | `core/source.ts` | Parse source strings → `ResolvedSource` (type, fetch URL, ref, subpath) |
| Git runner | `core/git.ts` | Thin `spawn` wrapper: `clone --depth 1`, `ls-remote`, `rev-parse`; structured errors |
| Cache service | `core/cache.ts` | Materialize sources into cache, slugging, meta sidecar, cache GC |
| Manifest service | `core/manifest.ts` | Load + zod-validate `contexts.yml`, produce mapping diagnostics (valid/drifted) |
| Linker | `core/linker.ts` | Plan → execute link operations; conflict policy; orphan pruning |
| Lockfile service | `core/lockfile.ts` | Read/write/validate `contexts.lock`; stable key ordering for clean diffs |
| Hasher | `core/hash.ts` | SHA-256 of files; directory digest for local sources |
| UI | `ui/prompts.ts`, `ui/reporter.ts` | clack prompts, summary tables, drift reports; all skippable via flags |

## Execution pipelines

### `add`
1. Resolve source string → `ResolvedSource`.
2. Materialize into cache (clone/copy), capture `resolvedRef`.
3. Load + validate `contexts.yml`; compute mapping diagnostics against `process.cwd()`.
4. Interactive selection (targets, link names) — or flag-driven in non-interactive mode.
5. Linker plans operations, detects conflicts, prompts/aborts/forces per policy.
6. Execute links, compute hashes, merge entries into `contexts.lock`, ensure `.gitignore` covers `.contexts/`.
7. Print summary.

### `install`
1. Read `contexts.lock`; fail with exit 4 if missing/invalid.
2. Group entries by `source`; materialize each source once at its `resolvedRef`.
3. Verify each `contextPath` hash == `computedHash`; mismatch → exit 4 listing offenders (`--force` re-pins instead).
4. Rebuild all links/copies idempotently (silent overwrite of contexts-owned paths only).

### `update`
1. For each lock source: query upstream HEAD (`git ls-remote`) or recompute local directory digest.
2. No change → report up-to-date. Change → re-materialize, diff per-entry hashes, show changed entries.
3. Apply (with confirmation unless `--yes`), refresh `resolvedRef` + `computedHash`, prune orphaned links for mappings that vanished upstream.

## Invariants

- contexts never writes outside: target link paths, `.contexts/`, `contexts.lock`, `.gitignore` (append-only, single line).
- contexts never deletes a regular file it does not own (ownership = path is a current/previous lock entry AND content hash matches the lock).
- `contexts.lock` is always written atomically (tmp + rename) with sorted keys and trailing newline.
- Cache is always reproducible — deleting `.contexts/` entirely is safe; `install` rebuilds it.

## Future (explicitly out of v1 scope)

Glob targets in `contexts.yml` (`src/services/*`), content templating/variables, `remove` and `init` commands, multi-file profile bundles (link a directory, not just a file), a `check --ci` strict mode beyond `status --json`.
