# Phase 3 — Manifest Parsing & Drift Diagnostics

You are implementing phase 3 of the `contexts` CLI. Read first: `docs/IMPLEMENTATION-LOG.md`, `docs/04-data-formats.md` (§contexts.yml), `docs/02-architecture.md` (§pipelines `add` steps 3–4 context), `docs/03-cli-reference.md` (§add flags `--target`, `--include-drifted`).

## Goal

`add` can read a cached source's `contexts.yml`, validate it strictly, evaluate every mapping against the consumer project's real directory tree, and print an accurate diagnostics report.

## Build

1. `src/core/manifest.ts`:
   - zod schema for contexts.yml exactly per docs/04 §contexts.yml (version literal "1", mappings record, optional name/description, field constraints).
   - `loadManifest(cacheDir): Manifest` — YAML parse errors and schema errors become `CliError(2, ...)` quoting the offending key/path; post-validation: key normalization, duplicate-after-normalization detection, `..`/absolute rejection for keys and `context_source`, context_source existence + regular-file check inside the cache (path-traversal guard: resolve and assert prefix).
   - `diagnose(manifest, projectRoot): MappingDiagnostic[]` where each diagnostic is `{ target, contextSource, description, state: "valid" | "drifted" }` (drifted = target dir missing, per docs/01 glossary).
2. `src/ui/reporter.ts`: add `printDiagnostics(diags)` — aligned list: green check for valid, yellow warning lines for drifted ("mapped in contexts.yml but src/foo does not exist here"), plus a one-line totals summary. JSON mode emits the diagnostics array.
3. Wire into `commands/add.ts` after materialization: load → diagnose → print. Implement `--target` filtering at the diagnostics level (unknown `--target` value → `CliError(2)` listing available targets) and `--include-drifted` (drifted entries become selectable downstream; without it they're report-only). Selection UI itself is phase 4 — for now end with the printed report and a "selection & linking land in phase 4" notice.
4. Fixtures: extend `tests/fixtures/` with `contexts-invalid/` variants (bad version, no mappings, duplicate keys, traversal in context_source, missing agent file) and a fixture with a root `"."` mapping.
5. Tests per docs/08 manifest row: each invalid fixture asserts its distinct error message and exit 2; diagnose tested against a fabricated project tree (valid + drifted + root mapping).

## Out of scope

Prompt-based selection, linking, lockfile.

## Acceptance gate

```sh
npm run lint && npm run typecheck && npm test && npm run build
# scratch dir containing only src/components/:
node .../bin/contexts.js add .../tests/fixtures/contexts-basic
# → report: src/components valid, src/api drifted; exit 0
node .../bin/contexts.js add .../tests/fixtures/contexts-invalid-version; echo $?   # exit 2, message names the version problem
node .../bin/contexts.js add .../contexts-basic --target src/nope; echo $?          # exit 2, lists valid targets
node .../bin/contexts.js add .../contexts-basic --json                              # diagnostics as JSON
```

Append phase summary to `docs/IMPLEMENTATION-LOG.md`.
