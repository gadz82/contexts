# 05 — Source Resolution

`core/source.ts` turns the user's source string into a `ResolvedSource`. Accepted forms mirror `npx skills add` (GitHub shorthand, full URLs, git URLs, local paths) plus an optional `#ref` pin.

## Accepted input forms

| Input | sourceType | Canonical `source` | Notes |
|---|---|---|---|
| `org/repo` | `github` | `org/repo` | Shorthand. Must match `/^[\w.-]+\/[\w.-]+$/` AND not exist as a local path (local path check wins — warn when ambiguous). |
| `https://github.com/org/repo` | `github` | `org/repo` | `.git` suffix stripped. |
| `https://github.com/org/repo/tree/<ref>[/subpath]` | `github` | `org/repo` | `<ref>` becomes the requested ref; `subpath` (if present) becomes the contexts root inside the repo — lets one repo host several contexts collections. |
| `https://gitlab.com/org/repo[...]` or any other https git remote | `git` | full URL | Cloned as-is. |
| `git@host:org/repo.git` | `git` | full URL | SSH; relies on user's ssh agent. |
| `./path`, `../path`, `/abs/path` | `local` | absolute resolved path | Must contain `contexts.yml`. |
| any of the above + `#<ref>` | — | — | Explicit ref pin (branch, tag, SHA). `#` split happens before all other parsing; not applicable to local (exit 2). |

`ResolvedSource` shape:

```ts
interface ResolvedSource {
  raw: string;            // what the user typed
  source: string;         // canonical form stored in the lock
  sourceType: "github" | "git" | "local";
  fetchUrl: string | null;   // https clone URL for github, URL for git, null for local
  requestedRef: string | null; // from #ref or /tree/<ref>; null = default branch
  subpath: string | null;    // contexts root inside the repo
  localPath: string | null;  // absolute path for local
}
```

## Fetch strategies (`core/git.ts` + `core/cache.ts`)

### github / git
1. `git --version` check once per process (missing git → exit 3 with install hint).
2. `add`/`update`: `git clone --depth 1 [--branch <requestedRef>] <fetchUrl> <tmpdir>`. If `requestedRef` is a SHA (not clonable shallowly by branch), fall back to full clone + `git checkout <sha>` (or `fetch origin <sha>` where supported).
3. Capture `resolvedRef` via `git -C <tmpdir> rev-parse HEAD`.
4. `install`: clone then `checkout <resolvedRef>` exactly; any failure → exit 3.
5. Copy the worktree (minus `.git/`) — or `subpath` only, when set — into `.contexts/cache/<slug>/`, replacing previous content atomically (write to `<slug>.tmp`, rm old, rename).
6. Auth: delegate entirely to the user's git config/credential helper/ssh agent. Never prompt for credentials ourselves; on auth failure, surface git's stderr plus a hint.

### local
1. Resolve to absolute path; verify directory + `contexts.yml` exist.
2. `fs.cp(src, cacheDir, { recursive: true })` excluding `.git/` and `node_modules/`.
3. `resolvedRef: null`; compute `directoryDigest` for the meta sidecar (see 04 §Hashing).
4. Lock stores the absolute path — document the trade-off: local-source locks are machine-specific; `install` on another machine fails with a clear message suggesting the team move the contexts repo to git. (vercel/skills has the same property.)

## Cache slugging

`slug(source)`:
- github: `github-<org>-<repo>[-<subpath with / → ->]`
- git: `git-<sha256(url).slice(0,12)>`
- local: `local-<sha256(absPath).slice(0,12)>`

Deterministic, filesystem-safe (`[a-z0-9-]`), collision-resistant enough; collisions across different canonical sources are acceptable to ignore in v1 given hashed forms.

## Validation & errors

- Empty/whitespace source → exit 2.
- Shorthand that also exists on disk → treat as local, print one-line notice ("interpreting as local path; use the full GitHub URL to force remote").
- Clone timeout: 120 s default, kill process group, exit 3.
- `subpath` must exist in the clone and contain `contexts.yml`, else exit 2 ("no contexts.yml at <subpath> in <source>").
- Refuse sources whose `contexts.yml` is missing at root: exit 2 with "this doesn't look like a contexts repository — expected contexts.yml at the root (or pass a /tree/<ref>/<subpath> URL)".
