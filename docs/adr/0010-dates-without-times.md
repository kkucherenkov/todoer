# 10. v1 has dates, never times

- **Status:** accepted
- **Date:** 2026-09-25

## Context

A task can be scheduled for a day or for a moment. A moment requires a time
zone, and a time zone requires deciding whose — the task's, the user's at
creation, or the user's right now.

## Decision

Every date field is a date. There are no times of day and no time zones in v1.

## Consequences

Daylight-saving arithmetic, the meridian problem and the largest single source
of recurrence defects stop existing rather than being handled. "Every Monday"
is the same Monday in every country.

The calendar view is a grid of days, not of hours.

What is given up is a capability a task list mostly does not use: most items
are "some time that day". Reminders at a specific time are the obvious thing
this forecloses, and they are the first likely extension.

Adding times later costs a `timestamptz` column and a time zone on the user. No
structure below changes, because a date stays a date — which is why this is a
cheap simplification rather than a corner cut.
