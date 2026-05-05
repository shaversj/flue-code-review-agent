# TypeScript and JavaScript Checks

Focus on:

- unsafe async flows and missing error handling
- invalid assumptions around `null` or `undefined`
- mismatches between runtime validation and static types
- shell, process, or filesystem calls without guardrails
- accidental review of generated files or build outputs
- expensive recursive scans or duplicated work
- brittle parsing, coercion, or unchecked external input

Prefer findings with a clear failure mode over speculative style feedback.
