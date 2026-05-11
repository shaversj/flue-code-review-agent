# Language-Specific Checks

This reference covers language-specific review heuristics for the source types
the reviewer currently scans.

## JavaScript and TypeScript

Focus on:

- unsafe async flows and missing error handling
- invalid assumptions around `null` or `undefined`
- mismatches between runtime validation and static types
- shell, process, or filesystem calls without guardrails
- accidental review of generated files or build outputs
- expensive recursive scans or duplicated work
- brittle parsing, coercion, or unchecked external input

Prefer findings with a clear failure mode over speculative style feedback.

## Python

Focus on:

- subprocess execution with `shell=True` or command strings built from external
  input
- unsafe deserialization such as permissive YAML loading or `eval`-style
  execution
- broad `except` blocks that hide real failures or skip cleanup
- mutable default arguments that leak state across calls
- path construction or file deletion derived from unchecked input

Prefer findings with a concrete runtime or security impact over lint-like style
observations.

## SQL

Focus on:

- string-built queries where parameters should be bound separately
- write operations without transaction boundaries when partial failure matters
- destructive statements without clear scoping, predicates, or safety rails
- schema assumptions that can return the wrong rows or break on `NULL`
- migrations or DDL changes that are not reversible or not ordered safely

Prefer findings with a clear data-loss, integrity, or correctness risk.

## Java

Focus on:

- `null` assumptions that can trigger `NullPointerException` on real input or
  error paths
- resource handling that leaks files, sockets, streams, or database resources
  without `try-with-resources`
- exception handling that swallows the root cause or converts checked failures
  into misleading success paths
- unsafe string-built SQL, shell, or filesystem operations from external input
- concurrency or shared-mutable-state assumptions that can break under parallel
  access

Prefer findings with a concrete correctness, reliability, or security failure
mode over style-only API preferences.

## Dockerfile

Focus on:

- secrets copied into the image or embedded through build arguments that persist
- containers running as root without a clear need
- unpinned or overly broad base images that make builds non-reproducible
- remote script execution patterns such as `curl | sh` without verification
- package installation that leaves unnecessary tooling or attack surface behind

Prefer findings that materially affect runtime security, reproducibility, or
operational safety.

## Makefile

Focus on:

- shell commands assembled from unchecked variables or user-controlled values
- destructive targets without clear guardrails or confirmation points
- targets that ignore command failures and continue in a bad state
- environment-dependent behavior that changes silently across machines or CI
- recursive or duplicated work that makes builds unexpectedly expensive

Prefer findings that can cause incorrect builds, unsafe execution, or hidden
failure.

## Other Supported Languages and Files

The review surface also includes:

- `.py`, `.sql`, `.go`, `.rs`, `.java`
- `.c`, `.cc`, `.cpp`, `.cs`, `.rb`, `.php`
- `Dockerfile`, `Makefile`

Use the core checks in [SKILL.md](../SKILL.md) for these files today, and apply
language-specific heuristics only when the failure mode is clear from the code.
