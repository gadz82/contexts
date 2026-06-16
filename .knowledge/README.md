# contexts — Specification & Implementation Package

A zero-config, deterministic context package manager for AI agent profiles (`AGENTS.md`, `CLAUDE.md`, `.cursor/rules`). Modeled on the DX of `npx skills` (vercel-labs/skills), adapted to a different problem: instead of installing *skills* into agent config directories, `contexts` distributes *directory-scoped agent context files* from a central contexts repository into the right places inside a codebase, with symlinks, a content-addressed cache, and a self-contained lockfile.

## How vercel/skills maps to contexts

| Concern | vercel-labs/skills | contexts |
|---|---|---|
| Unit of distribution | Skill dir (`SKILL.md` + assets) | Agent profile file (`AGENTS.md` et al.) |
| Install destination | Agent config dirs (`.claude/skills/`, `.agents/skills/`, ...) | Project source dirs (`src/api/`, `src/components/`, ...) |
| Destination discovery | Hardcoded agent registry (55+ agents) | `contexts.yml` mappings validated against the real tree |
| Canonical copy | `.agents/skills/` canonical + symlinks per agent | `.contexts/cache/<source>/` canonical + symlinks per target |
| State | lockfile, self-contained entries | `contexts.lock`, self-contained entries + pinned commit SHA |
| Restore | re-add from lock | `contexts install` (npm-ci-like) |

## Package contents

```
contexts/
├── README.md                      ← you are here
├── docs/                          ← the specification, split by concern
│   ├── 01-overview.md             Vision, goals, non-goals, glossary
│   ├── 02-architecture.md        System architecture & core pillars
│   ├── 03-cli-reference.md       Full command/flag/exit-code spec
│   ├── 04-data-formats.md        contexts.yml + contexts.lock schemas, hashing
│   ├── 05-source-resolution.md   Source string parsing & fetch strategies
│   ├── 06-linking-engine.md      Symlink algorithm, conflicts, Windows
│   ├── 07-project-structure.md   Repo layout, modules, deps, build
│   └── 08-testing-strategy.md    Unit/integration/e2e plan, fixtures
└── prompts/                       ← multi-phase implementation prompts
    ├── 00-orchestration.md        How to run the phases, gates, conventions
    ├── phase-1-scaffold.md
    ├── phase-2-cache-engine.md
    ├── phase-3-manifest-validation.md
    ├── phase-4-linking-ui.md
    ├── phase-5-lock-install.md
    ├── phase-6-update-status-list.md
    └── phase-7-hardening-release.md
```

## How to use this package

1. Create a **private** repository (company policy — all repos private, no exceptions) and copy `docs/` and `prompts/` into it.
2. Open `prompts/00-orchestration.md` and follow it: feed one phase prompt at a time to your coding agent (Cursor, Claude Code, Codex — prompts are agent-neutral).
3. Each phase ends with an acceptance gate (commands + expected output). Do not start phase N+1 until phase N's gate passes.
4. The spec in `docs/` is the source of truth. Phase prompts reference doc sections instead of restating them, so keep both in the repo the agent works in.

## Key decisions locked in this spec

TypeScript (Node ≥ 20, ESM, bundled to a single `dist/index.js`), commander + @clack/prompts + picocolors + yaml + zod, no heavy git library (thin `spawn` wrapper), vitest. Command surface: `add`, `install`, `update`, `status`, `list`. Lockfile v1 is fully self-contained and pins git sources to a resolved commit SHA. Symlinks are relative with copy fallback recorded per entry (`linkMode`), so `status` always knows the truth.
