# The domain and the sync protocol

`todoer` is a self-hosted personal task manager with three clients — web, a
command-line tool, and a Flutter application — all of which must work with no
network. That constraint, not the feature list, is what shapes everything
below: a client that can answer "what is due today" on a plane holds a full
replica, and a full replica turns every other decision into a question about
how replicas disagree.

This is **sub-project 1 of three**. It settles the data model, the
synchronisation protocol and the API contract. Sub-project 2 designs the
configurable views (list, kanban, calendar) and sub-project 3 the per-platform
client shell; neither can start before this one is built, because all three
views and all three clients read this model.

**Goal:** a task created offline on any client reaches every other client
without losing an edit, and a recurring task behaves correctly when two devices
have been apart for a week.

## 1. Decisions

Each decision that constrains what can be built later, is expensive to reverse,
or will make someone ask "why is it like this" has its own record under
[`docs/adr/`](../adr/). They are the durable form: individually linkable, with a
lifecycle, and they outlive this document. This section is the map, not a
second copy — restating them here would guarantee the two drift.

| ADR | Decision |
| --- | --- |
| [0002](../adr/0002-recurrence-is-virtual.md) | A recurring task is a rule plus completion and exception logs, not one row per occurrence |
| [0003](../adr/0003-client-outbox-not-event-sourcing.md) | The operation log is a client outbox against server-held state; no event sourcing |
| [0004](../adr/0004-field-level-last-write-wins.md) | Conflicts resolve last-write-wins per field, with `base_version` on destructive operations |
| [0005](../adr/0005-client-generated-identifiers.md) | Clients generate UUIDv7 identifiers; there is no temporary-id mapping |
| [0006](../adr/0006-three-generic-operations.md) | The outbox has three verbs: `create`, `set`, `delete` |
| [0007](../adr/0007-tags-only-no-contexts.md) | There are tags and nothing else; a context is a tag whose name begins with `@` |
| [0008](../adr/0008-fractional-index-for-ordering.md) | Manual order is a fractional index stored as a string |
| [0009](../adr/0009-subtask-completion-uses-the-parent-occurrence.md) | Subtasks are two levels deep and live on the parent's occurrence axis |
| [0010](../adr/0010-dates-without-times.md) | v1 has dates, never times of day, and therefore no time zones |
| [0011](../adr/0011-bearer-everywhere-cookie-only-for-refresh.md) | Bearer for every data request; the only cookie carries the refresh token, on the web |
| [0012](../adr/0012-no-rest-surface.md) | There is no REST surface; `POST /sync` is the entire data plane |
| [0013](../adr/0013-tombstones-and-the-retention-contract.md) | Deletion is a tombstone, and tombstone retention is a contract with offline clients |
| [0014](../adr/0014-owner-first-registration-and-two-path-reset.md) | The first account is the owner; afterwards registration needs an invitation. Reset uses SMTP when configured and the owner otherwise |
| [0015](../adr/0015-the-cli-is-a-client-for-automation.md) | The CLI is a network client for scripts and agents, not a server-side utility |

Two smaller choices have no record of their own because nothing downstream is
constrained by them:

- **The RRULE test vectors are a data file in the shared spec package**, read by
  four test suites. Four implementations of one rule are unavoidable — an
  offline client must answer "what is due today" without a server. What is
  avoidable is that their disagreement goes unnoticed.
- **Priority is an enumeration of five values, 0 meaning none.** A numeric range
  without semantics becomes an argument with oneself about what 7 means.


## 2. The entity model

```text
task                          project                tag
  id           uuid v7          id      uuid v7        id     uuid v7
  title        text             name    text           name   text
  notes        text?            rank    text           color  text?
  project_id   uuid?            archived_at ts?
  parent_id    uuid?                                  task_tag
  priority     int 0..4       completion                task_id uuid
  scheduled_on date?             id          uuid v7    tag_id  uuid
  due_on       date?             task_id     uuid
  rrule        text?             occurrence  date?    exception
  dtstart      date?             completed_at ts         id         uuid v7
  rank         text              value       numeric?    task_id    uuid
  version      int                                       occurrence date
  field_ts     jsonb
  seq          bigint
  deleted_at   ts?
  created_at   ts
  updated_at   ts
```

Every table carries `seq`, `deleted_at`, `version` and `field_ts`; they are
listed once on `task` to keep the sketch readable.

Unique indexes on `completion(task_id, occurrence)` and
`exception(task_id, occurrence)` are what make `create` idempotent by natural
key, in addition to the operation's own id.

Three columns are present before anything uses them — `due_on`, `parent_id`
(D9 uses it immediately) and `completion.value`. This is a deliberate exception
to leaving things out until needed, and it applies **only to offline-first
projects**: adding a nullable column later is one migration, while adding a
field to a contract that three clients read from local databases is a schema
version on every client, a migration of a cache belonging to a user who has not
opened the application in a week, and a window during which an old client sends
operations that omit the field. The costs differ by roughly an order of
magnitude, so the line falls in a different place than it would for a
server-rendered application.

## 3. The sync protocol

```jsonc
// POST /sync
{
  "since": 4711,
  "ops": [
    { "op_id": "0192a1…", "kind": "create", "table": "task",
      "id": "0192b2…", "fields": { "title": "Call the bank", "rank": "an" },
      "ts": "2026-09-25T10:11:12Z" },
    { "op_id": "0192a2…", "kind": "set", "table": "task",
      "id": "0192b2…", "field": "priority", "value": 2,
      "ts": "2026-09-25T10:11:20Z" },
    { "op_id": "0192a3…", "kind": "delete", "table": "task",
      "id": "0192b9…", "base_version": 7 }
  ]
}

// 200
{
  "cursor": 4802,
  "results": [
    { "op_id": "0192a1…", "status": "applied" },
    { "op_id": "0192a2…", "status": "superseded" },
    { "op_id": "0192a3…", "status": "conflict", "current_version": 9 }
  ],
  "changes": [
    { "table": "task", "id": "0192c1…", "row": { }, "seq": 4712 }
  ]
}
```

### What the server does

For each operation, in the order given:

1. **Seen before?** `op_id` in `applied_op` → `duplicate`, skip. This is what
   makes a retry after a lost response safe.
2. **Permitted?** The table is writable, the row belongs to this user, a
   `parent_id` points at a row whose own `parent_id` is null (D9), a subtask
   carries no `rrule`. Otherwise `rejected` with a reason.
3. **`set`:** clamp `ts` into `[now − 24h, now + 5min]`, then apply only if it
   is newer than `field_ts[field]`. Otherwise `superseded` — which is an
   outcome, not an error.
4. **`delete`:** compare `base_version` against the row's `version`. Mismatch →
   `conflict`, carrying `current_version` so the client can show what it is
   colliding with.
5. **Apply**, increment `version`, write `field_ts`, take the next `seq`,
   record the `op_id`.

Then return every row with `seq > since`, including tombstones.

### What the client does

Queue operations in the outbox and apply them optimistically to the local
replica. On the response: drop `applied` and `duplicate` from the outbox;
drop `superseded` silently, since the server's value is already arriving in
`changes`; surface `conflict` and `rejected` to the person, because both mean
an intent did not happen. Then merge `changes` and advance the cursor.

A `410 Gone` means the cursor predates tombstone retention: discard the local
replica, fetch `GET /sync/snapshot`, and start again. This path must be
exercised by a test rather than discovered in production, because the failure
it prevents is invisible — a client that silently never learns about deletions
keeps showing tasks that no longer exist.

## 4. Recurrence

`dtstart` anchors the rule; `rrule` is an RFC 5545 recurrence rule restricted
to `FREQ` (DAILY, WEEKLY, MONTHLY, YEARLY), `INTERVAL`, `BYDAY`, `BYMONTHDAY`,
`BYMONTH`, `BYSETPOS`, `COUNT`, `UNTIL` and `WKST`. `BYHOUR`, `BYMINUTE` and
`BYSECOND` are unsupported, following from D8. `RDATE` is unnecessary because
`exception` covers the case from the other side.

Answering "what is due in this window" means expanding the rule across the
window, then subtracting the dates present in `completion` and `exception`.
That happens in four places: the server, the web client, the Flutter client and
the CLI.

The shared test vectors (D18) are a JSON file of
`{ rrule, dtstart, window, expected[] }` cases. The set must include, at
minimum: the last working day of a month; 29 February; a fifth Sunday;
`UNTIL` falling exactly on an occurrence; and an `INTERVAL` spanning a year
boundary. These are the cases where library behaviour actually differs.

## 5. The API

```text
POST   /auth/register          first run (becomes owner), or with an invitation
POST   /auth/login             email and password
POST   /auth/forgot            request a reset; the answer never reveals whether
                               the address is known
POST   /auth/reset             consume a reset token
POST   /auth/device/code       CLI: begin the device flow
POST   /auth/device/token      CLI: poll until confirmed
POST   /auth/refresh           cookie (web) or body (Flutter, CLI)
POST   /auth/logout            revoke the refresh token
DELETE /auth/account           purge this user and everything they own

POST   /auth/invites               owner only: issue an invitation
POST   /auth/users/{id}/password   owner only: reset another user's password

POST   /sync                   the entire data plane
GET    /sync/snapshot          full state: first sign-in, and after 410

GET    /health
```

Authentication is the larger half of the surface, and deliberately so: it is
the only part a self-hosted operator has to reason about, and the part where a
gap is not recoverable. The two owner-only routes exist because
[ADR 0014](../adr/0014-owner-first-registration-and-two-path-reset.md) makes the
owner the recovery channel when no mail is configured — without them, resetting
another user would need database access, and the client would have grown a
privileged path that [ADR 0015](../adr/0015-the-cli-is-a-client-for-automation.md)
exists to prevent.

`DELETE /auth/account` purges rather than tombstones. Tombstones exist so other
replicas learn about a deletion; when the account is gone there is no replica
left to tell, and the other devices simply stop authenticating.

Errors are RFC 9457 `application/problem+json`, so three clients parse one
shape. `413` is reserved for an outbox that has grown past what one request may
carry — a client returning after a month offline should get a clear refusal
rather than a timeout.

The consequence worth naming: this contract is close to frozen after its first
version. Subtasks, habits, quantified completions and any future field add no
endpoint, because all of them are expressed by three verbs inside `/sync`. What
changes is `components/schemas`, never `paths`.

## 6. Out of scope for v1

- **Times of day and time zones** (D8). The first likely extension.
- **The habit tracker.** Planned for v2. The schema accommodates it already:
  `completion` is permanent, `completion.value` exists for quantified habits,
  and `exception` already distinguishes a deliberate skip from a missed day —
  which is what lets an excused absence not break a streak.
- **Nested projects.** A later `parent_id` on `project` if it is ever wanted.
- **Sharing and collaboration.** Users are isolated; this assumption is load
  bearing for D2 and reversing it reopens the sync design.
- **The views** (list, kanban, calendar) and **the client shells** — sub-projects
  2 and 3.
- **A terminal client.** Wanted for v2, in the spirit of `tuxedo`. Worth
  recording now because its cost is not the interface: the offline requirement
  makes every client thick, so a TUI needs its own local replica, outbox,
  replay and recurrence expansion. It takes the shared test vectors from four
  implementations to five, and it belongs to sub-project 3 rather than beside
  it.
