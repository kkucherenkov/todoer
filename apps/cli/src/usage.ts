import { UsageError } from './protocol.js';

/**
 * Everything a caller has to know that is not in the wire contract: what the
 * quick-add markers do and do not do, where the token comes from and how long
 * it lasts, what each exit code means, and the one sharp edge — `add` is not
 * idempotent. That last paragraph was, until now, written down only in the
 * plan, where the agent retrying a failed `add` was never going to read it.
 */
export const HELP = `todoer — a client for a todoer instance

usage:
  todoer add "<text>" [--json]    create a task
  todoer list [--json]            list the tasks that are not deleted
  todoer --help

quick-add markers:
  p0..p4      priority
  #project    parsed, not stored yet — projects arrive with the outbox
  @tag        parsed, not stored yet — tags arrive with the outbox

environment:
  TODOER_URL     instance base URL, default http://localhost:3000/api/v1
  TODOER_TOKEN   bearer token. It expires 15 minutes after it is issued and
                 this CLI has no login command yet — mint one with
                 POST $TODOER_URL/auth/login and export it.

exit codes (ADR 0015 §2):
  0  done
  1  the server refused: a rejected operation, or any 4xx. A 401 means the
     token is missing, invalid or expired — get a new one, do not retry
  2  usage error — nothing was sent
  3  the server could not be reached, or answered 5xx. The only code a
     caller may retry unchanged
  4  reserved for a conflict — the server holds a newer version of the row.
     No command sends an operation that can return one yet: add sends a
     create, and a create never conflicts. The code is wired, so the first
     command that sends a set or a delete brings it alive

add is NOT safe to retry. Each invocation mints a fresh operation id, so a
retry after a lost response creates the task twice; the server's idempotency
is keyed on that id (ADR 0005, ADR 0015 §4). Treat a failed add as
indeterminate and run list before deciding. The persistent outbox that makes
a retry reuse the original id is plan B.
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
