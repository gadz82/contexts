# 01 — Overview

## Problem

Organizations accumulate high-quality agent context (`AGENTS.md`, `CLAUDE.md`, Cursor rules) but have no way to distribute it across many repositories consistently. Teams copy-paste files, they drift, nobody knows which version a repo has, and updating 40 repos is manual labor.

## Solution

`contexts` is a CLI that treats agent context files as versioned, installable packages:

- A **contexts repository** (git repo or local directory) is the single source of truth. It contains agent profile files plus a `contexts.yml` manifest mapping *target project paths* to *agent source files*.
- A consumer project runs `npx contexts add <source>`, picks which mappings to apply, chooses output filenames (`AGENTS.md`, `CLAUDE.md`, or both), and gets relative symlinks from its source tree into a local content cache.
- An `contexts.lock` file records everything needed to reproduce the exact state on any machine — `npx contexts install` is the `npm ci` equivalent.

## Goals

- **Zero config in consumer repos.** No init step; `add` does everything, `install` restores everything.
- **Deterministic.** Lock pins git sources to a commit SHA and every file to a SHA-256 content hash. `install` either reproduces exact state or fails loudly.
- **Self-contained lock.** `install` never reads `contexts.yml`; the lock alone is sufficient (mirrors vercel/skills lock semantics).
- **Portable.** All symlinks relative; moving or re-cloning the project never produces dead links pointing at another machine's home directory.
- **Cross-platform.** First-class symlinks on macOS/Linux; graceful, recorded copy fallback on restricted Windows.
- **Honest state.** `status` reports per-entry truth: OK, locally modified, broken link, missing, drifted, or stale vs upstream.

## Non-goals (v1)

- No central registry or discovery service (no `find` command, no skills.sh equivalent).
- No skill execution semantics — contexts distributes *context files*, it does not interpret them.
- No transformation/templating of file content (files are linked byte-for-byte; templating is a future idea, see 02-architecture “Future”).
- No telemetry.
- No monorepo workspace awareness beyond plain directory paths.

## Glossary

| Term | Meaning |
|---|---|
| **Contexts repo** | A repository/directory containing agent profile files + `contexts.yml`. |
| **Mapping** | One `contexts.yml` entry: target project path → agent source file. |
| **Target** | A directory in the consumer project where a profile gets linked (e.g. `src/api`). |
| **Agent profile** | The context file being distributed (`AGENTS.md` content). |
| **Link name** | Filename created in the target (`AGENTS.md`, `CLAUDE.md`, ...) — one source can be linked under several names. |
| **Cache** | `.contexts/cache/<source-slug>/` — local canonical copy that symlinks point at. Git-ignored. |
| **Lock** | `contexts.lock` at project root. Committed. Self-contained restore record. |
| **Drift** | A `contexts.yml` mapping whose target directory does not exist in the consumer project. |

## Primary user stories

1. *Platform engineer (context author):* maintains `org/engineering-contexts` with curated profiles per stack; edits one file, every consuming repo gets it on next `update`.
2. *Developer (consumer):* clones a repo, runs `npx contexts install`, gets identical agent context as CI and teammates.
3. *Tech lead:* runs `npx contexts status` in CI to fail builds when context files were hand-edited or links are broken.

## Spec reading order

02 (architecture) → 04 (data formats) → 05 (source resolution) → 06 (linking) → 03 (CLI) → 07 (project structure) → 08 (testing).
