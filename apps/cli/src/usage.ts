import { UsageError } from './protocol.js';

/**
 * Everything a caller has to know that is not in the wire contract: what the
 * quick-add markers do and do not do, where the token comes from and how long
 * it lasts, and what each exit code means. Every command sends the outbox
 * first; `add` is safe to run once because its operation id is stored with
 * it and reused on every later send.
 */
export const HELP = `todoer — a client for a todoer instance

usage:
  todoer add "<text>" [--json]           create a task
  todoer list [--json]                   list the tasks that are not deleted
  todoer outbox [--json]                 list operations the server has not accepted
  todoer outbox drop <op-id>... [--json] forget failed operations
  todoer --help

Every command first sends the operations waiting in the outbox and fetches
what changed. Without a server it answers from the local copy and exits 5.

quick-add markers:
  p0..p4      priority
  #project    parsed, not stored — reported on stderr
  @tag        parsed, not stored — reported on stderr

environment:
  TODOER_URL         instance base URL, default http://localhost:3000/api/v1
  TODOER_TOKEN       bearer token. It expires 15 minutes after it is issued and
                     this CLI has no login command yet — mint one with
                     POST $TODOER_URL/auth/login and export it.
  TODOER_TIMEOUT_MS  how long to wait for the server, default 3000

local state:
  $HOME/.config/todoer/todoer.db — the local copy and the outbox (SQLite)

--json prints exactly one object:
  {"data": ..., "synced": true|false, "outbox": {"pending": n, "failed": n}}

exit codes (ADR 0015 §2):
  0  done, and the server has it
  1  the server refused: this command's operation was rejected, or the
     request was refused (401, 403, …). A 401 means the token is missing,
     invalid or expired — get a new one; queued operations stay queued
  2  usage error — the command did nothing (the outbox may still have been
     sent)
  3  an unexpected local failure, such as the local database staying busy
  4  reserved for a conflict — the server holds a newer version of the row.
     No command sends an operation that can return one yet: add sends a
     create, and a create never conflicts
  5  the server was not reached: the answer is local, and any operation
     this command queued will be sent by a later command. Do not run the
     command again for the same intent — that would queue it twice

add is safe to run once: its operation id is stored with the operation and
reused on every later send, so a lost response never creates the task twice
(ADR 0005, ADR 0015 §4).

An operation the server refuses after the command that queued it has exited
is kept as failed: todoer outbox lists it, todoer outbox drop forgets it.
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
