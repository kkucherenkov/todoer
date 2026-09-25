# 6. The outbox has three verbs

- **Status:** accepted
- **Date:** 2026-09-25

## Context

An operation vocabulary can be one entry per user action — `task_add`,
`task_complete`, `task_move` — or a small generic set. Every client must
understand every operation it receives, including a client that has not been
updated for a week.

## Decision

Three operations: `create`, `set`, `delete`. Everything else is which table is
touched.

## Consequences

Completing an occurrence is a row in `completion`; skipping one is a row in
`exception`; moving a task between projects is a `set`; adding a tag is a row in
`task_tag`. Reordering is a `set` on the rank, which
[0008](0008-fractional-index-for-ordering.md) makes possible.

The property that decides it: **a new feature adds no operation types**.
Subtasks, habits, quantified completions and every future field are expressed
by the same three verbs, so an old client still understands everything it is
sent. A named-intent vocabulary grows with the product, and each addition is a
thing old clients must learn to ignore.

What is lost is readability of the log and per-operation merge semantics. An
intent vocabulary would make "postpone to tomorrow" distinguishable from "set
the date to tomorrow", and would make undo easier to build. Neither is needed
yet; if undo is wanted later it can be built from inverse operations rather
than from named intents.

Idempotency comes from two directions: the operation's own id, and a natural
key on the tables that carry one — `completion(task_id, occurrence)` is unique,
so a redelivered completion cannot double-apply even if the operation id were
lost.
