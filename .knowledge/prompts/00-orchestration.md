# Prompt Strategy — Orchestration Guide

How to drive the implementation with any coding agent (Cursor, Claude Code, Codex, etc.).

## Setup

1. Create a **private** git repository named `contexts` (company policy: all repos private — e.g. `gh repo create contexts --private`).
2. Copy `docs/` and `prompts/` from this package into the repo root before the first session. The prompts reference doc files by path; agents must be able to read them.
3. Run each phase in a **fresh agent session** with only that phase's prompt pasted in. The prompt tells the agent which docs to read — don't paste docs into context manually.

## Rules of engagement (apply to every phase)

- **Spec wins.** If implementation and `docs/` disagree, fix the implementation or stop and flag the spec gap — never silently diverge. Spec changes are made by editing `docs/` in the same PR, called out explicitly.
- **One phase per branch/PR.** Branch `phase-N-<name>`; merge only when the acceptance gate passes.
- **Gate before next phase.** Each prompt ends with an "Acceptance gate" — exact commands and expected results. Run them yourself (don't just trust the agent's claim). If the gate fails, continue in the same session with the failure output; do not start phase N+1.
- **No scope creep.** Each prompt has an "Out of scope" list; later phases depend on those things *not* existing yet in half-built form.
- **Carry-over note.** At the end of each phase, have the agent append a short entry to `docs/IMPLEMENTATION-LOG.md`: what was built, deviations, TODOs. The next phase's prompt instructs the agent to read it — this is the cross-session memory.

## Phase map and dependencies

| Phase | Builds | Depends on | Spec docs |
|---|---|---|---|
| 1 | Repo scaffold, toolchain, CLI harness, error/UI plumbing, CI | — | 07, 03 (§flags, exit codes) |
| 2 | Source resolver, git runner, cache service, hashing, gitignore util | 1 | 05, 04 (§hashing), 06 (§gitignore) |
| 3 | contexts.yml manifest service + drift diagnostics + reporter output | 2 | 04 (§contexts.yml), 02 |
| 4 | Linking engine (plan/execute/conflicts/fallback) + interactive add UI | 3 | 06, 03 (§add) |
| 5 | Lockfile service, lock writing in add, full `install` | 4 | 04 (§contexts.lock), 03 (§install) |
| 6 | `update`, `status`, `list` + orphan pruning | 5 | 03 (§update/status/list), 06 (§pruning) |
| 7 | Cross-platform hardening, full test matrix, packaging, docs | 6 | 08, 07 |

Phases are strictly sequential. Estimated session size: each phase fits comfortably in one agent session; phase 4 is the largest — if the agent struggles, split it at the marked seam (plan engine first, then interactive flow).

## Verification philosophy

Tests are written *in the phase that builds the feature*, not deferred to phase 7 (phase 7 only completes the matrix and e2e). Every gate includes `npm run typecheck && npm run lint && npm test` plus phase-specific manual checks. A phase that "works" but ships no tests does not pass its gate.
