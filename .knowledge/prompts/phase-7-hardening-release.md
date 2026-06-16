# Phase 7 — Hardening, Cross-Platform & Release Prep

You are implementing phase 7 (final) of the `contexts` CLI. Read first: `docs/IMPLEMENTATION-LOG.md` (entire — audit every recorded TODO/deviation), `docs/08-testing-strategy.md` (entire), `docs/03-cli-reference.md` (§exit codes, §UX conventions), `docs/02-architecture.md` (§Invariants).

## Goal

Ship-ready: complete test matrix, invariants proven, polished UX, packaged artifact. No new features.

## Build

1. **Test-matrix completion.** Diff the implemented suite against every row/flow in docs/08; add whatever is missing — notably: subprocess smoke tests of the built `dist/index.js` via the bin shim (one happy path, one error path asserting exit code), portability `mv` test, subpath+ref source flow, coverage threshold (85 % lines on `src/core/**`) enforced in vitest config.
2. **Invariant audit.** For each invariant in docs/02 §Invariants, point to the test that proves it; write the missing ones. Add a fuzz-ish test: run add/install/update/status sequences against a project tree containing hostile names (spaces, unicode, `AGENTS.md` directory, pre-existing dead symlinks) — no invariant may break.
3. **Windows leg.** Make the CI windows job actually pass: path normalization fixes, forced-EPERM fallback test green, CRLF-safety test (a context file with CRLF hashes identically through cache copy).
4. **Error catalog pass.** Grep every `CliError` site; ensure each message states what happened + one actionable next step (docs/03 §UX). Verify exit codes against the docs/03 table with a parametrized test.
5. **UX polish.** Consistent intro/outro, spinner labels, summary tables across all five commands; `--verbose` adds timing + git stderr; `--json` audited on every command for prompt-free, parseable output.
6. **Docs.** Write the repo `README.md` for end users: what/why, quickstart (`add`/`install`/`update`/`status`/`list`), contexts-authoring guide (contexts.yml by example), CI recipe (`contexts install` + `contexts status` in pipelines), Windows notes, local-source caveat. Update root `AGENTS.md` if layout drifted.
7. **Packaging.** `npm pack` artifact in CI; verify install-from-tarball in a clean dir runs `npx contexts --version`; confirm `files` whitelist, license file, `engines`. Repo stays **private** (company policy); publishing to any registry is a separate, explicitly-approved step — prepare but do not execute (document the release checklist in `docs/RELEASE.md`).

## Out of scope

New commands or schema changes. Anything discovered that needs spec change → update `docs/` + log it, only if strictly required for correctness.

## Acceptance gate

```sh
npm run lint && npm run typecheck && npm test && npm run build && npm pack
# CI green on ubuntu + macos + windows (all jobs)
# coverage report ≥ 85% lines on src/core/**
# in a clean tmp dir: npm i -g ./contexts-0.1.0.tgz && contexts --version
# manual smoke per docs/08 §Manual smoke script against a real private contexts repo
```

Close `docs/IMPLEMENTATION-LOG.md` with a release-readiness summary: open risks, deferred items, v1.1 candidates (remove, init, glob targets, multi-file bundles — see docs/02 §Future).
