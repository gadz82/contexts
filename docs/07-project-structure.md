# 07 — Project Structure & Toolchain

## Repository layout

Repository hosting note: company policy requires this repo (and any repo created during implementation) to be **private** on whatever platform hosts it (`gh repo create contexts --private`). Never publish it public or flip visibility.

```
contexts/
├── bin/
│   └── contexts.js          # 2-line shebang shim importing ../dist/index.js
├── src/
│   ├── index.ts                # commander program: registers commands, global flags, version
│   ├── commands/
│   │   ├── add.ts              # orchestrates the add pipeline (02 §pipelines)
│   │   ├── install.ts
│   │   ├── update.ts
│   │   ├── status.ts
│   │   └── list.ts
│   ├── core/
│   │   ├── source.ts           # ResolvedSource parsing (05)
│   │   ├── git.ts              # spawn wrapper: clone/lsRemote/revParse, GitError
│   │   ├── cache.ts            # CacheService: materialize, slug, meta sidecar
│   │   ├── manifest.ts         # contexts.yml zod schema + diagnostics (04, phase 3)
│   │   ├── lockfile.ts         # contexts.lock zod schema, atomic read/write (04)
│   │   ├── linker.ts           # plan/execute/prune (06)
│   │   └── hash.ts             # sha256 file + directory digest (04)
│   ├── ui/
│   │   ├── prompts.ts          # clack wrappers honoring --yes/--json/non-TTY
│   │   └── reporter.ts         # tables, drift report, summaries, JSON emitter
│   ├── utils/
│   │   ├── fs.ts               # atomicWrite, exists, posixify, ensureDir
│   │   ├── gitignore.ts        # ensureIgnored (06)
│   │   ├── platform.ts         # isCI, isTTY, symlink capability probe
│   │   └── errors.ts           # CliError(exitCode, message, hint) hierarchy + top-level handler
│   └── types.ts                # shared interfaces (ResolvedSource, LinkOperation, LockFile, ...)
├── tests/
│   ├── unit/                   # mirrors src/ one test file per module
│   ├── integration/            # tmp-dir end-to-end flows (08)
│   └── fixtures/
│       ├── contexts-basic/        # contexts.yml + 2 agents
│       ├── contexts-invalid/      # broken manifests for validation tests
│       └── contexts-subpath/      # repo with contexts under packages/contexts
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
├── .github/workflows/ci.yml    # lint + typecheck + test on ubuntu/macos/windows matrix
├── AGENTS.md                   # context for agents working on this repo (dogfooding)
└── README.md
```

## Toolchain decisions

| Concern | Choice | Rationale |
|---|---|---|
| Language | TypeScript strict, ESM only (`"type": "module"`) | Typed schemas; matches vercel/skills |
| Node | `>=20` (`engines`) | stable `fs.cp`, fetch, structuredClone |
| CLI framework | `commander` | per original plan; battle-tested routing |
| Prompts | `@clack/prompts` | the Vercel-style UX the plan asks for |
| Colors | `picocolors` | tiny |
| YAML | `yaml` | maintained, no eval |
| Validation | `zod` | runtime schemas == doc contract (04) |
| Git | none (thin `child_process.spawn` wrapper) | avoid simple-git weight; we need 3 subcommands; use `spawn` not `execSync` (no shell injection, streamable, timeout-able) |
| Bundler | `tsup` → single `dist/index.js` (esm, node20 target, minify off) | fast `npx` cold start, one file to ship |
| Tests | `vitest` | TS-native, fast |
| Lint/format | `biome` (or eslint+prettier if preferred) | one tool |
| Release | `npm pack` artifact in CI; publish step manual | publishing policy reviewed before any registry push; repo private per policy |

## package.json essentials

```jsonc
{
  "name": "contexts",
  "version": "0.1.0",
  "type": "module",
  "bin": { "contexts": "bin/contexts.js" },
  "files": ["bin", "dist", "README.md"],
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "biome check ."
  }
}
```

Runtime deps only: `commander`, `@clack/prompts`, `picocolors`, `yaml`, `zod`. Everything else dev-deps. Keep the dependency budget at five — every addition needs a reason in PR description.

Naming note: the bare name `contexts` is almost certainly taken (or squattable) on the public npm registry, and `npx contexts` resolves whatever owns that name publicly. Since the repo is private and publishing is deferred to phase 7, this costs nothing now — but at publish time use a scoped name (`@gadz82/contexts`, invoked as `npx @gadz82/contexts`) or an internal registry. The `bin` entry keeps the command itself as plain `contexts` either way.

## Coding conventions

- Commands (`src/commands/*`) contain **orchestration only** — no fs/git calls; they compose `core/*` services. Core modules take paths/options as arguments (no `process.cwd()` inside core; resolved once in command layer) → fully unit-testable.
- All user-facing failures throw `CliError(exitCode, message, hint)`; the single top-level handler in `index.ts` formats and exits. No scattered `process.exit`.
- No `console.log` outside `ui/reporter.ts`.
- Every core module gets JSDoc with a reference to its spec doc section (e.g. `@see docs/06-linking-engine.md`).
