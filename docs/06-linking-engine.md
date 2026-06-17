# 06 — Linking Engine

`core/linker.ts`. Two phases, always: **plan** (pure, returns `LinkOperation[]`, used by `--dry-run` and tests) then **execute**.

## Plan

For each selected mapping × each chosen link name, produce:

```ts
interface LinkOperation {
  target: string;        // "src/api" (normalized)
  linkName: string;      // "AGENTS.md"
  linkPath: string;      // absolute: <root>/src/api/AGENTS.md
  cachedFile: string;    // absolute: <root>/.contexts/cache/<slug>/agents/backend/AGENTS.md
  relTarget: string;     // path.relative(path.dirname(linkPath), cachedFile)
  action: "create" | "replace-link" | "conflict" | "skip-ok";
  mode: "symlink" | "copy";
}
```

Classification of the existing path (`lstat`, never `stat`, to see the link itself):
- nothing there → `create`
- symlink (any destination) → `replace-link` if it doesn't already resolve to `cachedFile`, else `skip-ok` (idempotency)
- regular file whose hash matches the lock entry for this target (copy-mode artifact we own) → `replace-link`
- regular file otherwise → `conflict`
- directory → hard error, exit 2 (someone has a directory named AGENTS.md; do not touch)

## Conflict policy (`conflict` actions)

| Context | Behavior |
|---|---|
| Interactive | clack select per conflict: **backup & replace** (write `<name>.bak`, then link) / **skip** / **abort all** |
| `--force` | backup & replace, no prompt (backup still written; `.bak.2` etc. if taken) |
| Non-interactive, no `--force` | skip + warning; reported in summary; exit 0 |

Backups are never overwritten silently and never tracked in the lock.

## Execute

1. `fs.mkdir(path.dirname(linkPath), { recursive: true })` — covers `--include-drifted` targets.
2. Remove existing link/owned file (`fs.rm`, not unlink-on-dir).
3. Symlink mode: `fs.symlink(relTarget, linkPath, "file")` — the stored link value is **relative** (pillar 3). Verify by `fs.readlink` + resolve + `fs.access`.
4. Copy fallback: catch `EPERM`/`EACCES`/`ENOSYS`/`UNKNOWN` from symlink → `fs.copyFile(cachedFile, linkPath)`, set op mode to `copy`, collect for a single prominent end-of-run warning ("symlinks unavailable — N files were copied; updates require re-running contexts update; enable Windows Developer Mode for symlinks"). Any other error → bubble up (exit 1).
5. Return executed ops; caller writes `linkMode` per entry into the lock from what *actually* happened, not what was requested.

## Orphan pruning (used by `add`, `update`, future `remove`)

Given previous lock entries vs new desired state, compute orphans = (old target × linkName) pairs absent from the new set. For each orphan: remove only if it is a symlink resolving into our cache OR a regular file hashing to the old lock entry's `computedHash`. Otherwise leave it and warn ("not removing src/api/AGENTS.md — content doesn't match what contexts installed"). This enforces the "never delete files we don't own" invariant (02 §Invariants).

## `.gitignore` management (`utils/gitignore.ts`)

- Ensure a line `.contexts/` exists in the project-root `.gitignore`; create the file if absent; append with a `# contexts cache` comment; idempotent (exact-line match, also recognize `.contexts` without slash).
- Never gitignore `contexts.lock` — if a pattern in `.gitignore` matches it (`git check-ignore` equivalent: simple pattern scan is fine for v1), print a warning.
- Symlinked profile files in the tree **are committed** by design (they're tiny relative links; teammates without the cache see them as broken until `install` — `status` explains this). Document the alternative (`--copy` for teams that want real files committed... but then content drift is on them; `status` still catches it via hashes).

## Windows specifics

- `fs.symlink(..., "file")` type arg matters on Windows; always pass it.
- Developer Mode or admin grants `SeCreateSymbolicLinkPrivilege`; without it symlink throws `EPERM` → copy fallback path above. No junctions (junctions are directory-only; our links are files).
- Path normalization: lock keys and `contextPath` always POSIX (`/`); convert with `path.posix`/`path.win32` helpers in `utils/fs.ts` at the boundary only.
- Tests must cover: relative link computation on `win32` paths, copy fallback recording, CRLF-untouched hashing.

## Idempotency contract

Running the same `add`/`install` twice produces zero filesystem mutations the second time (all ops classify `skip-ok`) and a byte-identical `contexts.lock`. This is a hard acceptance test (08-testing §integration).
