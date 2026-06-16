# Phase 1 — Scaffold & CLI Harness

You are implementing phase 1 of the `contexts` CLI. Read these spec files first, in order: `docs/07-project-structure.md` (entire), `docs/03-cli-reference.md` (sections: global flags, exit codes, UX conventions), `docs/01-overview.md` (skim for context). If `docs/IMPLEMENTATION-LOG.md` exists, read it.

## Goal

A buildable, testable TypeScript CLI skeleton: all five commands registered and runnable as polished stubs, shared error/UI plumbing in place, CI green on three OSes.

## Build

1. Repo scaffold exactly per `docs/07-project-structure.md`: package.json (name, bin, files, engines, scripts, the five runtime deps only), tsconfig (strict, ESM, node20), tsup config bundling `src/index.ts` → `dist/index.js`, vitest config, biome config, `bin/contexts.js` shebang shim.
2. `src/index.ts`: commander program — version from package.json, commands `add <source>`, `install`, `update [targets...]`, `status`, `list` (alias `ls`), global flags `--json`, `--yes/-y`, `--dry-run`, `--verbose`. Each command calls its module in `src/commands/` which currently prints a "not implemented (phase N)" notice via the reporter and exits 0.
3. `src/utils/errors.ts`: `CliError(exitCode, message, hint?)` class + the exit-code table from docs/03 as named constants; top-level handler in `index.ts` catches everything, formats via reporter (red message, dim hint), exits with the right code. Unexpected errors → exit 1 with stack only under `--verbose`.
4. `src/utils/platform.ts`: `isInteractive()` (TTY && !CI && !--yes && !--json) plus a symlink capability probe (create+remove a temp symlink, cached result).
5. `src/ui/reporter.ts`: intro/outro banner, `info/warn/error`, simple aligned table function, and a JSON mode switch that silences decoration. `src/ui/prompts.ts`: thin clack wrappers that throw `CliError(2, ...)` when a prompt would be needed in non-interactive mode.
6. Environment check helper: verify `git --version` works (used from phase 2; build it now in `src/core/git.ts` with just `assertGitAvailable()`).
7. `.github/workflows/ci.yml`: matrix ubuntu/macos/windows, node 20: install, lint, typecheck, test, build, `npm pack --dry-run`.
8. Unit tests: errors mapping, platform interactivity logic (env-var driven), reporter table snapshot.
9. `AGENTS.md` at repo root: 15 lines max — project purpose, layout pointers, "spec lives in docs/, spec wins" rule.

## Out of scope

Any real command logic, fs/git/cache/lock code, prompts flows. Do not create `src/core/` modules beyond the git availability stub, and no `src/types.ts` content beyond what compiles.

## Acceptance gate

```sh
npm run lint && npm run typecheck && npm test && npm run build
node bin/contexts.js --version          # prints version
node bin/contexts.js add foo/bar        # "not implemented (phase 2)" notice, exit 0
node bin/contexts.js nope; echo $?      # commander usage error, exit 2
node bin/contexts.js add --json foo/bar # valid JSON on stdout, no banners
npm pack --dry-run                         # only bin/, dist/, README.md
```

Then append a summary entry to `docs/IMPLEMENTATION-LOG.md` (create it): what was built, any deviations from docs/07, TODOs for phase 2.
