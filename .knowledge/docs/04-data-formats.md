# 04 — Data Formats

Both schemas are defined as zod schemas in code (`core/manifest.ts`, `core/lockfile.ts`); this document is the human-readable contract. Zod is the source of truth; keep them in sync.

## `contexts.yml` (contexts repo root)

```yaml
version: "1"                      # manifest schema version, string
name: engineering-contexts    # optional, shown in add UI
description: Curated agent context for a service   # optional

mappings:
  src/components:
    context_source: ./agents/frontend/AGENTS.md
    description: React component architecture context
  src/api:
    context_source: ./agents/backend/AGENTS.md
    description: API controller conventions
  ".":                            # project-root mapping is allowed
    context_source: ./agents/root/AGENTS.md
    description: Repo-wide conventions
```

Validation rules (zod + post-checks):
- `version` required, must be `"1"` (unknown → exit 2 with "upgrade contexts" hint).
- `mappings` required, ≥ 1 entry. Keys are POSIX-style relative paths; normalized (`./` stripped, no trailing `/`); must not escape root (`..` forbidden) and must not be absolute.
- `context_source` required; relative to the contexts repo root; must exist in the fetched source and be a regular file; `..` escape forbidden (path traversal guard — resolve and verify prefix).
- `description` optional, ≤ 200 chars (UI truncates).
- Duplicate normalized keys → exit 2.

## `contexts.lock` (consumer project root, committed)

JSON, 2-space indent, keys sorted, trailing newline, written atomically (tmp file + rename).

```json
{
  "version": 1,
  "contexts": {
    "src/api": {
      "source": "/Users/francesco/work/shared-contexts",
      "sourceType": "local",
      "resolvedRef": null,
      "contextPath": "agents/backend/AGENTS.md",
      "linkedAs": ["AGENTS.md"],
      "linkMode": "symlink",
      "computedHash": "8474cbd9c99f6447cb04bfec872389638b523d247191938bb0a2c4e3132d7d4f"
    },
    "src/components": {
      "source": "your-org/engineering-contexts",
      "sourceType": "github",
      "resolvedRef": "9f2c1e7a4b5d3f8e0a1b2c3d4e5f60718293a4b5",
      "contextPath": "agents/frontend/AGENTS.md",
      "linkedAs": ["AGENTS.md", "CLAUDE.md"],
      "linkMode": "symlink",
      "computedHash": "1b6f82e889d19d305e38e35594de08eca0242321f353cafa4cf5e61dd3aa1a73"
    }
  }
}
```

Field contract per entry (key = normalized target path):

| Field | Type | Notes |
|---|---|---|
| `source` | string | Canonical form produced by the resolver: `owner/repo` for github, full URL for generic git, absolute path for local. What the user typed is normalized; see 05. |
| `sourceType` | `"github" \| "git" \| "local"` | Drives fetch strategy on install/update. |
| `resolvedRef` | string \| null | Commit SHA pinned at add/update time. `null` for local sources. **This is the determinism improvement over hash-only locks** — install checks out exactly this ref before verifying hashes. |
| `contextPath` | string | Path of the profile file inside the contexts repo, POSIX separators. |
| `linkedAs` | string[] | ≥ 1 filename, unique, each matching `/^[A-Za-z0-9._-]+\.md$/` plus allowance for dotfile names (e.g. `.cursorrules`) — validated, never path segments. |
| `linkMode` | `"symlink" \| "copy"` | What was actually created. `status`/`update`/`install` branch on this. |
| `computedHash` | string | Lowercase hex SHA-256 of the file content (raw bytes, no newline normalization). |

Lock invariants:
- Self-contained: `install` uses only this file (pillar 2 in 02-architecture).
- One entry per target path. One target maps to exactly one agent file (but many link names).
- `version` bump policy: breaking schema change → increment, old CLI refuses newer lock (exit 4, "upgrade contexts"), new CLI migrates older lock in place with a notice.

## Hashing rules (`core/hash.ts`)

- **File hash:** `sha256(raw bytes)`, lowercase hex. No EOL normalization — context authors own their line endings; document that contexts repos should ship LF and consumers should gitignore the cache (they do, automatically).
- **Directory digest** (local-source change detection for `update`): walk the source dir, exclude `.git/`, sort entries by POSIX relpath, digest = `sha256(concat(relpath + "\0" + filehash + "\n"))`. Stored only in `.contexts-meta.json`, never in the lock.

## `.contexts-meta.json` (cache sidecar, git-ignored, informational)

```json
{
  "source": "your-org/engineering-contexts",
  "sourceType": "github",
  "resolvedRef": "9f2c1e7...",
  "directoryDigest": null,
  "fetchedAt": "2026-06-10T09:30:00Z"
}
```

If missing or stale, commands re-derive from the lock; corruption here must never break anything.
