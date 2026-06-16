# contexts — agent context

Deterministic context package manager: distributes agent profile files
(`AGENTS.md`, `CLAUDE.md`, ...) from a contexts repo into consumer projects via
relative symlinks + a self-contained `contexts.lock`.

Layout: `src/commands/` (orchestration only), `src/core/` (fs/git/cache/lock/
link/hash/manifest services), `src/ui/` (reporter + prompts), `src/utils/`
(errors, platform, fs, gitignore). Tests mirror `src/` under `tests/`.

Rules: commands compose core services and never touch fs/git directly. All
failures throw `CliError(exitCode, message, hint)`; only `index.ts` exits.
`console.log` only in `ui/reporter.ts`.

The spec lives in `docs/` and is the source of truth. If code and spec
disagree, fix the code or change the spec in the same PR — never silently
diverge.
