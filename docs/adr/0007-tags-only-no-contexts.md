# 7. There are tags and nothing else

- **Status:** accepted
- **Date:** 2026-09-25

## Context

The original request named contexts and tags as separate things. GTD treats a
context as where or how a task can be done.

## Decision

One entity: `tag`. A context is a tag whose name begins with `@` — a derived
classification, not a stored flag.

## Consequences

A single-valued context breaks on the first real example: "call the bank" is
`@phone`, but it is also doable `@home` and `@office`, and picking one loses the
task in two lists out of three. OmniFocus, the most orthodox GTD application
there is, replaced contexts with multi-valued tags in version 3. Todoist and
Things never had contexts at all. Three products arrived at the same answer
independently.

Because the classification is derived from the name, it cannot disagree with
it. A stored `is_context` flag can be set on a tag without `@` and cleared on a
tag with one, and then the interface and the data contradict each other.

Converting a tag into a context is a rename — an ordinary `set` — with no
special operation and no migration.

The `@` also becomes working syntax for quick entry, which is the CLI's primary
way of creating a task: `todoer add "call the bank @phone #finance p2"`. The
parser must require the token to stand alone, or every email address in a title
becomes a tag.

## Amendment (2026-10-01, #362)

Quick-add now stores `@name` as the tag's name, so a context is a tag whose
name starts with `@`, as this decision says. Names compare by `nameKey`
(NFC, then lower case) from `@todoer/specs`, so `@Phone` and `@phone` are one
tag; the stored spelling is never changed. Two offline clients can create the
same name, so duplicates are tolerated: every client merges them after a pull,
the lowest id winning. The decision that a rename is an ordinary `set` stands.
Details: [the quick-add design](../specs/2026-09-28-quick-add-tags-projects-design.md).
