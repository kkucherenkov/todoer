import { UsageError } from './protocol.js';

/**
 * Everything a caller has to know that is not in the wire contract: what the
 * quick-add markers do and do not do, where the token comes from and how long
 * it lasts, and what each exit code means. Every command sends the outbox
 * first; every write is safe to run once because its operation id is stored
 * with it and reused on every later send.
 */
export const HELP = `todoer — a client for a todoer instance

usage:
  todoer add "<text>" [--rrule <RRULE> [--from YYYY-MM-DD]] [--json]
                                          create a task; with --rrule it recurs
                                          from --from (default: today)
  todoer list [@tag|#project ...] [--json]   what is open now: each task once,
                                          a recurring one at its current date;
                                          filters keep tasks carrying every
                                          named label
  todoer done <ref> [--on YYYY-MM-DD] [--json]   mark done
  todoer skip <ref> [--on YYYY-MM-DD] [--json]   mark skipped
  todoer undo <ref> [--on YYYY-MM-DD] [--json]   reopen (default: the latest
                                          done or skipped occurrence)
  todoer outbox [--json]                  list operations the server has not accepted
  todoer outbox drop <op-id>... [--json]  forget failed operations
  todoer --help

Every command first sends the operations waiting in the outbox and fetches
what changed. Without a server it answers from the local copy and exits 5.

references:
  list starts each line with the last 6 characters of the task's id. done,
  skip and undo take the full id or any unique ending of it, at least 4 hex
  digits — an ending, not a beginning: ids start with a timestamp.

recurrence:
  --rrule takes an RFC 5545 rule, restricted to FREQ (DAILY, WEEKLY,
  MONTHLY, YEARLY), INTERVAL, BYDAY, BYMONTHDAY, BYMONTH, BYSETPOS, COUNT,
  UNTIL (YYYYMMDD) and WKST; upper case. No times of day. A recurring task
  is listed at the latest date on or before today that is still open, else
  at the next open one; missed dates before it are not listed. done and
  skip act on that date, or on --on's.

quick-add markers:
  p0..p4      priority
  #project    the live, non-archived project of that name (any case);
              created if there is none. An archived project is never
              matched, so #name next to an archived project of that name
              creates a new one
  @tag        a tag stored with its @ (a context); matched by name in any
              case, created if there is none
  Created names are reported on stderr. Two devices that create the same
  name offline end up with two rows; every client merges them after its
  next sync (lowest id wins) and says so on stderr. A merge's operations are
  queued, not sent: the next command sends them, so --json outbox.pending
  can be non-zero right after a successful command.

environment:
  TODOER_URL         instance base URL, default http://localhost:3000/api/v1
  TODOER_TOKEN       bearer token. It expires 15 minutes after it is issued and
                     this CLI has no login command yet — mint one with
                     POST $TODOER_URL/auth/login and export it.
  TODOER_TIMEOUT_MS  how long to wait for the server, default 3000

local state:
  $HOME/.config/todoer/todoer.db — the local copy and the outbox (SQLite)

--json: every command that exits 0 or 5 prints exactly one object:
  {"data": ..., "synced": true|false, "outbox": {"pending": n, "failed": n}}
on 1-4 stdout is empty and the reason is on stderr.

exit codes (ADR 0015 §2):
  0  done, and the server has it
  1  the server refused: this command's operation was rejected, or the
     request was refused (401, 403, …). A 401 means the token is missing,
     invalid or expired — get a new one; queued operations stay queued; if
     a write command (add, done, skip, undo) exits 1 this way, its
     operation is still queued — fix the cause and run any command (for
     example list) to send it, not the same command again
  2  usage error — the command did nothing (the outbox may still have been
     sent)
  3  an unexpected local failure, such as the local database staying busy
  4  reserved for a conflict — the server holds a newer version of the row.
     No command sends an operation that can return one yet: add, done, skip
     and undo each send a create, and a create never conflicts
  5  the server was not reached: the answer is local, and any operation
     this command queued will be sent by a later command. Do not run the
     command again for the same intent — that would queue it twice

Every write is safe to run once: its operation id is stored with the operation
and reused on every later send, so a lost response never applies the
operation twice (ADR 0005, ADR 0015 §4).

An operation the server refuses after the command that queued it has exited
is kept as failed: todoer outbox lists it, todoer outbox drop forgets it.
A failed delete whose row is already deleted on the server is dropped from the
outbox automatically.
`;

/**
 * Whether this invocation is asking for the help text.
 *
 * Only the first argument, never a scan of the whole of argv. `add` takes the
 * rest of the line as the title, so a scan made `todoer add "review the -h
 * flag docs"` print the help and exit 0 having created nothing — the same
 * silent discarding of a caller's input that refusing an empty title was
 * meant to end, one layer up.
 */
export function wantsHelp(argv: string[]): boolean {
  return argv[0] === '--help' || argv[0] === '-h';
}

/** The usage error a command name that is not a command deserves. */
export function unknownCommand(command: string | undefined): UsageError {
  return new UsageError(
    command === undefined ? 'no command given' : `unknown command: ${command}`,
  );
}
