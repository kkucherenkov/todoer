# 1. Record architecture decisions

- Status: accepted
- Date: <DATE>

## Context

A decision that is only in someone's head is re-litigated every time a new
person — or a new session — meets the code it shaped. The code shows what was
decided and never why, so the alternatives get re-proposed, re-argued, and
sometimes re-adopted after they were already rejected for a reason nobody
wrote down.

## Decision

Record every architecturally significant decision as a numbered Markdown file
in `docs/adr/`, in the format of Michael Nygard's original ADR proposal:
context, decision, consequences. Numbers are sequential and never reused. A
superseded ADR stays in place with its status changed and a link to the one
that replaced it; it is never deleted, because the record of having changed
course is the point.

"Architecturally significant" means: it constrains what can be built later, it
is expensive to reverse, or someone will otherwise ask "why is it like this".

## Consequences

Decisions become reviewable in a pull request alongside the code they justify.
The cost is one small file per decision, written while the reasoning is still
in hand rather than reconstructed later.
