# contexts

Zero-config, deterministic context package manager for AI agent profiles
(`AGENTS.md`, `CLAUDE.md`, Cursor rules, …). It distributes directory-scoped
agent context from a central **contexts repository** into the right places
inside a codebase, using relative symlinks, a content-addressed cache, and a
self-contained lockfile.

Think `npm`/`npm ci`, but for the agent context files your team curates once and
wants every repo to share.

## Why

Teams accumulate good agent context and then copy-paste it across 40 repos. It
drifts, nobody knows which version a repo has, and updates are manual. `contexts`
makes that context **versioned, installable, and reproducible**.

## Install

Node ≥ 20.

```sh
npx @gadz82/contexts <command>          # no install
# or:
npm i -g @gadz82/contexts && contexts <command>
```

## Quickstart

```sh
# Add context from a contexts repo and link it into your tree
npx contexts add your-org/engineering-contexts

# Reproduce the exact same state on another machine / in CI
npx contexts install

# Pull upstream changes when the contexts repo is updated
npx contexts update

# See per-entry truth (CI-friendly: non-zero exit on problems)
npx contexts status

# List what's installed, straight from the lock
npx contexts list
```

### Source forms

```sh
contexts add your-org/repo                                   # GitHub shorthand
contexts add https://github.com/your-org/repo                # full URL
contexts add https://github.com/your-org/repo/tree/v2/sub    # ref + subpath
contexts add git@github.com:your-org/repo.git#v2             # SSH + ref pin
contexts add ../shared-contexts                              # local path
```

### Common flags

| Flag | Applies to | Meaning |
|---|---|---|
| `--target <paths...>` | add | pre-select mappings (`'*'` = all valid) |
| `--link-as <names...>` | add | link filenames (`AGENTS.md`, `CLAUDE.md`, …) |
| `--copy` | add | write real file copies instead of symlinks |
| `--force` | add / install | back up & replace conflicts / re-pin on hash mismatch |
| `--include-drifted` | add | offer mappings whose target dir doesn't exist yet |
| `--tag <name>` | add / update | use a named context variant (override/extend root mappings); switches context |
| `--check` | update | exit 5 if updates available, else 0 (apply nothing) |
| `--remote` | status | also check upstream for newer refs (network) |
| `--json` `-y` `--dry-run` `--verbose` | all | machine output / accept defaults / plan-only / verbose |

## Authoring a contexts repo

A contexts repository is any git repo (or local dir) with a `contexts.yml` at its
root (or under a subpath) plus the profile files it distributes:

```yaml
version: "1"
name: gadz82-engineering-contexts
description: Curated agent context for gadz82 services
mappings:
  src/components:
    context_source: ./agents/frontend/AGENTS.md
    description: React component architecture context
  src/api:
    context_source: ./agents/backend/AGENTS.md
    description: API controller conventions
  ".":
    context_source: ./agents/root/AGENTS.md
    description: Repo-wide conventions
```

- Keys are POSIX-relative target paths in the **consumer** project (`.` = root).
- `context_source` is relative to the contexts repo root; must be a regular file.
- Ship LF line endings; hashing is byte-exact with no EOL normalization.

### Tags — switchable context variants

Add a `tags:` block to ship alternative contexts (e.g. experimental, minimal)
that override or extend the defaults:

```yaml
mappings:
  src/api:
    context_source: ./agents/backend/AGENTS.md
tags:
  experimental:
    mappings:
      src/api:                              # override the default
        context_source: ./agents/backend/AGENTS.exp.md
      src/docs:                             # add a tag-only target
        context_source: ./agents/docs/AGENTS.md
```

```sh
contexts add your-org/repo --tag experimental   # link the experimental variant
contexts update --tag minimal                   # switch an installed repo's context
contexts update                                 # keep whatever tag the lock recorded
```

The effective set is `root ∪ tag` (tag wins on conflicts). The chosen tag is
recorded in `contexts.lock`, so `install` reproduces it and `update` re-resolves
the same variant.

## CI recipe

```yaml
- run: npx contexts install   # restore the pinned state (fails loudly on drift)
- run: npx contexts status    # exit 5 if any link is broken/modified/missing
```

`contexts install` reads **only** `contexts.lock` — it never needs `contexts.yml`
at restore time, so CI is deterministic.

## How it works

- The source is materialized into `.contexts/cache/<slug>/` (git-ignored
  automatically). Symlinks in your tree are **relative** and point into that
  cache, so moving or re-cloning the project never breaks them.
- `contexts.lock` (committed) pins each git source to a commit SHA and each file
  to a SHA-256 hash. `install` checks out exactly that SHA and verifies hashes.
- On filesystems without symlink support (e.g. Windows without Developer Mode),
  links fall back to file copies, recorded as `linkMode: "copy"` so `status` and
  `update` still track them by content hash.

## Windows notes

Symlinks need Developer Mode (or admin) for `SeCreateSymbolicLinkPrivilege`.
Without it, `contexts` automatically copies files instead and warns once;
`contexts update` rewrites those copies. Lock keys are always POSIX.

## Local-source caveat

A local-path source (`contexts add ../shared`) stores an **absolute** path in the
lock — it's machine-specific. `install` on another machine will fail with a clear
message. For shared/CI use, host the contexts repo in git.

## Exit codes

`0` success · `1` unexpected error · `2` usage/validation · `3` source fetch
failure · `4` lock integrity (missing/invalid/hash mismatch) · `5` status/check
findings.

## Acknowledgments

Inspired by Vercel's [skills](https://github.com/vercel/skills) library.

## Development

```sh
npm install
npm run lint && npm run typecheck && npm test && npm run build
```

The full specification lives in [`docs/`](./docs) and is the source of truth.
