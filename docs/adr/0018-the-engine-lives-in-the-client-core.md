# 18. The engine lives in the client core

- **Status:** accepted
- **Date:** 2026-10-03

## Context

The web client grew a long-lived loop around the client core in W1–W5:
single-flight sync, every write kind, and the topics a screen subscribes to.
It lived in `apps/web/app/db/engine.ts`. The terminal client
(`docs/specs/2026-10-03-tui-client-design.md`) needs the same loop; the CLI
does not, because each invocation is one command.

## Decision

`createEngine`, `dispatcher` and their types live in `@todoer/client-core`
(`engine.ts`, `engine-protocol.ts`). The engine depends on two narrow
session types, `EngineAuth` and `EngineTokens`, which the web's cookie
session and the TUI's stored session both satisfy. The web keeps only the
names of its browser transport: the channel, the leader lock, and the
worker's init and fatal messages.

The TUI is the fourth planned client, after the web, Flutter (ADR 0015) and
the CLI.

## Consequences

One place decides when to sync and how a write's result reaches a screen.
A change to the engine is a core change: it reaches both clients and is
tested once, in the core.

The dispatcher moved too, though only the web uses it: it has no browser
dependency, and moving it kept the engine's spec whole.

`engine.spec.ts` still lints under the web's syntax-only rules
(`eslint.config.mjs`); it moved with only its imports and its mocked module changed.
