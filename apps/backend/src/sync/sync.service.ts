import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { applyOp, type Op, type Outcome, type Row } from './apply-op.js';
import { lockUserWrites } from './user-lock.js';

type SyncRequest = { since: number; ops: Op[] };
type OpResult = {
  opId: string;
  status: 'applied' | 'duplicate' | 'superseded' | 'conflict' | 'rejected';
  reason?: string;
  currentVersion?: number;
};
type Change = {
  table: string;
  id: string;
  seq: number;
  row: Record<string, unknown>;
};

const TABLES = ['task', 'project', 'tag', 'task_tag'] as const;
type TableName = (typeof TABLES)[number];

const DELEGATE = {
  task: 'task',
  project: 'project',
  tag: 'tag',
  task_tag: 'taskTag',
} as const;

/**
 * The same four tables again, spelled as Postgres relations rather than as
 * Prisma delegates — the row lock below is raw SQL, and Prisma has no
 * `FOR UPDATE` on `findFirst`. Written out instead of derived from
 * `DELEGATE` by capitalisation so that a future `@@map` on a model shows up
 * here as an edit rather than as a runtime error.
 */
const RELATION = {
  task: 'Task',
  project: 'Project',
  tag: 'Tag',
  task_tag: 'TaskTag',
} as const;

/**
 * Foreign keys a client may write, and the table each one points at. Reads
 * are scoped by `userId`; these columns are not, and the migration's foreign
 * keys are global — so without this map one account can attach its row to
 * another's project or parent task. Nothing leaks today (`changesSince`
 * filters by `userId`), but the row is permanently in someone else's tree,
 * TaskTag's ON DELETE RESTRICT turns it into a hold on a row that account
 * owns, and the first feature to walk `parentId`/`projectId` — a cascade
 * delete, "complete subtasks", a tree view — crosses the boundary.
 */
const REFERENCES: Partial<
  Record<TableName, Readonly<Record<string, TableName>>>
> = {
  task: { projectId: 'project', parentId: 'task' },
  task_tag: { taskId: 'task', tagId: 'tag' },
};

/** The shape every id in this protocol has: a uuid, per the contract. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The largest `since` a cursor can carry. `seq` is a Postgres bigint, but
 * both the request and the response carry it as a JSON number, and above
 * 2^53-1 a JSON number is no longer the value that was written: a client
 * sending 9007199254740993 gets 9007199254740992 back, a cursor *lower* than
 * the one it sent. Anything above this bound is rejected rather than
 * silently rounded — and, further up, `Number.isInteger(1e300)` is true and
 * `BigInt(1e300)` succeeds, so without the bound a contract-legal input
 * reaches Postgres as an out-of-range bigint inside `changesSince`, which
 * has no catch of its own and answers 500.
 */
const MAX_SINCE = Number.MAX_SAFE_INTEGER;

/**
 * Columns a client may set through `create`/`set`, per table. `applyOp`
 * already guards the protocol-owned columns (id, version, fieldTs, seq,
 * deletedAt, ...); this guards the opposite direction — a field that is not
 * a column at all, which applyOp has no way to know and would otherwise
 * reach Prisma as an "unknown argument" and throw. See the sync design
 * doc's section 3, "Permitted?".
 */
const WRITABLE_FIELDS: Record<TableName, ReadonlySet<string>> = {
  task: new Set([
    'title',
    'notes',
    'projectId',
    'parentId',
    'priority',
    'scheduledOn',
    'dueOn',
    'rrule',
    'dtstart',
    'rank',
  ]),
  project: new Set(['name', 'rank', 'archivedAt']),
  tag: new Set(['name', 'color']),
  task_tag: new Set(['taskId', 'tagId']),
};

/**
 * The minimal shape this module needs from a Prisma model delegate, picked
 * dynamically by table name. Prisma's own delegate types don't unify across
 * models (each has its own create/update input type), so reaching them by a
 * runtime string requires a cast; this interface is the one place that cast
 * lands, kept to exactly the methods called below.
 */
type SyncDelegate = {
  findFirst(args: unknown): Promise<Row | null>;
  findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
  create(args: unknown): Promise<unknown>;
  update(args: unknown): Promise<unknown>;
};

/** The one method `lockRow` needs, so that it takes a transaction client
 *  without naming Prisma's full generated type. */
type RawClient = {
  $queryRaw<T = unknown>(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
};

type DelegateKey = (typeof DELEGATE)[TableName];

function delegateFor(client: unknown, table: TableName): SyncDelegate {
  return (client as Record<DelegateKey, SyncDelegate>)[DELEGATE[table]];
}

/**
 * The protocol columns a client's replica needs from every table — `seq`
 * is excluded on purpose, since it is already the `Change`'s own top-level
 * field, and it is a `bigint`, which has no `JSON.stringify` representation
 * of its own.
 */
const READABLE_PROTOCOL_FIELDS = [
  'id',
  'version',
  'fieldTs',
  'deletedAt',
] as const;

/**
 * The row as returned to a client: an explicit allow-list, not a deny-list
 * on an unrestricted `findMany`. A deny-list reaches every column a future
 * migration adds by default — including, one day, another `BigInt` — and
 * the failure that produces would land in production rather than in a
 * test. Naming exactly what a client receives means a new column stays out
 * until someone decides it belongs in `WRITABLE_FIELDS` or here.
 */
function toChangeRow(
  table: TableName,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of [...READABLE_PROTOCOL_FIELDS, ...WRITABLE_FIELDS[table]]) {
    if (key in row) out[key] = row[key];
  }
  return out;
}

/**
 * The field an op targets that is not one of `table`'s writable columns, or
 * `null` if there is nothing to object to here. A malformed `fields`/`field`
 * (wrong type, missing) is left to `applyOp`, which already rejects those —
 * this only adds the one check `applyOp` cannot make, because it does not
 * know the schema.
 */
function unpermittedField(table: TableName, op: Op): string | null {
  if (op.kind === 'create') {
    if (
      typeof op.fields !== 'object' ||
      op.fields === null ||
      Array.isArray(op.fields)
    )
      return null;
    for (const key of Object.keys(op.fields)) {
      if (!WRITABLE_FIELDS[table].has(key)) return key;
    }
    return null;
  }
  if (op.kind === 'set') {
    if (typeof op.field !== 'string') return null;
    return WRITABLE_FIELDS[table].has(op.field) ? null : op.field;
  }
  return null;
}

/**
 * Why this op's foreign keys cannot be written, or `null` if there is nothing
 * to object to. Three rules:
 *
 * - the referenced row must belong to the same user (reads are scoped by
 *   `userId`; these columns were not, and the migration's foreign keys are
 *   global);
 * - a `parentId` must point at a task with no parent of its own;
 * - a task that has live subtasks cannot be given a parent.
 *
 * The last two are the whole depth rule for a hierarchy the design caps at
 * two levels (project → task → subtask), and the second also closes every
 * cycle: a cycle needs every row in it to have a parent, so the edge that
 * would close one always points at a row that already has one. No recursive
 * query, no depth counter. Deleted subtasks do not count: a tombstone cannot
 * be resurrected, so it never becomes a live third level.
 *
 * Both rules read rows another request may be changing, so they hold only
 * because `lockRows` has already locked the written row and the target
 * before this runs — see there.
 *
 * A value that is not a uuid counts as unowned: it references no row of
 * theirs either, and letting it through would send client input into the raw
 * lock query below.
 */
async function referenceRejection(
  client: unknown,
  table: TableName,
  op: Op,
  userId: string,
): Promise<string | null> {
  const refs = REFERENCES[table];
  if (refs === undefined) return null;

  let written: Array<[string, unknown]>;
  if (op.kind === 'create') {
    // A malformed `fields` is applyOp's to reject, not this function's.
    if (
      typeof op.fields !== 'object' ||
      op.fields === null ||
      Array.isArray(op.fields)
    )
      return null;
    written = Object.entries(op.fields);
  } else if (op.kind === 'set') {
    written = typeof op.field === 'string' ? [[op.field, op.value]] : [];
  } else {
    written = [];
  }

  for (const [field, value] of written) {
    const target = refs[field];
    // `null` clears the reference, which needs no owner.
    if (target === undefined || value === null || value === undefined) continue;
    if (typeof value !== 'string' || !UUID.test(value)) {
      return `${field} does not reference a row you own`;
    }
    const isParent = field === 'parentId';
    const found = await delegateFor(client, target).findFirst({
      where: { id: value, userId },
      select: isParent ? { id: true, parentId: true } : { id: true },
    });
    if (found === null) return `${field} does not reference a row you own`;
    if (isParent && (found as { parentId?: string | null }).parentId !== null) {
      return 'parentId must point at a task that has no parent of its own';
    }
    // A `create` makes a row that cannot have children yet.
    if (isParent && op.kind === 'set') {
      const child = await delegateFor(client, 'task').findFirst({
        where: { parentId: op.id, userId, deletedAt: null },
        select: { id: true },
      });
      if (child !== null) {
        return 'parentId cannot be set on a task that has subtasks';
      }
    }
  }
  return null;
}

/** The task a `parentId` write points at, if this op makes one. */
function parentTarget(table: TableName, op: Op): string | null {
  if (table !== 'task') return null;
  let value: unknown;
  if (op.kind === 'set' && op.field === 'parentId') {
    value = op.value;
  } else if (
    op.kind === 'create' &&
    typeof op.fields === 'object' &&
    op.fields !== null
  ) {
    value = op.fields.parentId;
  }
  return typeof value === 'string' && UUID.test(value) ? value : null;
}

/**
 * Locks the row this op writes and, for a `parentId` write, the task it
 * points at — both before `referenceRejection` reads either, and always in id
 * order.
 *
 * Both halves are needed. Unlocked, two requests setting A under B and B
 * under A each read the other while it is still parentless, both pass and a
 * cycle is stored; the same happens when T gains a parent while a subtask of
 * T is created. Locking only the written row does not help, and ordering is
 * what stops it deadlocking: the UPDATE's foreign-key check takes FOR KEY
 * SHARE on the target, so a transaction that locked A and then touches B
 * waits on one that locked B and then touches A (40P01, a 500). With both
 * rows locked up front in a fixed order, the second request waits for the
 * first to commit and its checks then read what the first wrote — under
 * READ COMMITTED each statement sees the latest commit.
 *
 * A row that does not exist yet (a `create`) locks nothing, which is fine:
 * nothing else can reference it until it commits.
 */
async function lockRows(
  client: RawClient,
  table: TableName,
  op: Op,
  userId: string,
): Promise<void> {
  const target = parentTarget(table, op);
  const ids = target === null || target === op.id ? [op.id] : [op.id, target];
  for (const id of ids.sort()) await lockRow(client, table, id, userId);
}

/**
 * Takes the row's write lock for the rest of the transaction, so that the
 * read-modify-write cycle below runs one at a time per row.
 *
 * Without it, two concurrent `set` operations on *different* fields of one
 * row both read the same snapshot under READ COMMITTED and both write every
 * column back: the second write loses the first field's value *and* its
 * `fieldTs`, so the row ends up carrying the new timestamp against the old
 * value — a state no later per-field last-write-wins comparison can repair,
 * and one the client was told was `applied`. `version` ends up one short
 * too, which blinds `delete`'s and `set`'s base-version check to a change it
 * never saw. Per-field conflict resolution is what ADR 0004 exists to
 * provide, so this is not an optimisation.
 *
 * `FOR UPDATE` rather than REPEATABLE READ: Postgres would answer the race
 * with a serialisation failure (40001 → Prisma P2034), which this service
 * treats as retryable and rethrows — a 5xx, for an event the protocol
 * considers ordinary, leaving the client to retry a batch that was never
 * wrong. Under READ COMMITTED the lock instead makes the second cycle wait
 * and then re-read the row the first one committed, with nothing
 * client-visible about it at all.
 *
 * Raw because Prisma has no `FOR UPDATE` on `findFirst`. The table name is
 * a constant from `RELATION`, never client input; `id` and `userId` are
 * parameters, and `id` has been checked against `UUID` before this is
 * reached, so the `::uuid` casts cannot fail on it.
 */
function lockRow(
  client: RawClient,
  table: TableName,
  id: string,
  userId: string,
): Promise<unknown> {
  return client.$queryRaw`
    SELECT 1 FROM ${Prisma.raw(`"${RELATION[table]}"`)}
     WHERE "id" = ${id}::uuid AND "userId" = ${userId}::uuid
       FOR UPDATE
  `;
}

type StoredOutcome = {
  status: string;
  reason: string | null;
  currentVersion: number | null;
};

/**
 * Turns a previously recorded outcome back into the `OpResult` a fresh
 * application of the same op would have produced. This is what makes a
 * redelivered `conflict` or `rejected` surface to the client again on
 * replay, instead of arriving as a bare `duplicate` that the client's
 * outbox rule drops silently — dropping it silently is only correct for an
 * outcome that already had its effect, which is the one case this maps to
 * `duplicate` rather than replaying verbatim.
 */
function replay(opId: string, stored: StoredOutcome): OpResult {
  if (stored.status === 'applied') return { opId, status: 'duplicate' };
  const status = stored.status as 'superseded' | 'conflict' | 'rejected';
  return {
    opId,
    status,
    ...(stored.reason !== null ? { reason: stored.reason } : {}),
    ...(stored.currentVersion !== null
      ? { currentVersion: stored.currentVersion }
      : {}),
  };
}

/**
 * `PrismaClientKnownRequestError` codes where the operation itself was
 * fine and the database simply could not get to it this time — a retry
 * could plausibly succeed. Every other code (P2002 unique, P2003 foreign
 * key, P2025 not found, and the rest) means the operation is wrong and
 * will be wrong again. The criterion for adding to this set is "would a
 * retry plausibly succeed", not "is it a database error" — most
 * `PrismaClientKnownRequestError`s are not on it.
 */
const RETRYABLE_PRISMA_CODES = new Set([
  'P2028', // interactive transaction timeout — five seconds by default
  'P2034', // deadlock, or a write conflict the database itself detected
  'P2024', // timed out fetching a connection from the pool
  'P1017', // the database server closed the connection
  'P2037', // too many database connections already open
  'P2010', // a raw query failed — both raw queries in this service are
  // constant SQL (`SELECT nextval('change_seq')` and the row
  // lock), and the lock's only parameters are a uuid checked
  // against UUID before it is reached and a userId from the
  // session, so a failure executing either is the database's
  // problem, not the query's, by construction
]);

/**
 * A Postgres CHECK constraint violation (SQLSTATE 23514) as it reaches this
 * process. Matched on the message because there is nothing else to match on:
 * Prisma raises a check violation as `PrismaClientUnknownRequestError`, which
 * carries no `code` and no `meta` at all — unlike a unique or foreign-key
 * violation, which arrive as `PrismaClientKnownRequestError` with P2002 and
 * P2003. A constraint violation is as permanent as those two, so defaulting
 * it to retryable (see below) answers a deterministic refusal with a 5xx the
 * client is invited to retry forever.
 *
 * Pinned by a test that provokes the real constraint rather than building an
 * error object by hand, so a change in how Prisma renders this reaches the
 * suite instead of production.
 */
const CHECK_VIOLATION = /PostgresError \{ code: "23514"/;

/**
 * Whether a thrown error means "this operation may well succeed on a
 * retry" (true) or "this operation is wrong and retrying will not help"
 * (false). The boundary is retryability, not error class: a constraint
 * violation (`PrismaClientKnownRequestError`) and a value Prisma's own
 * input validation rejects (`PrismaClientValidationError` — a sibling
 * class, not a subclass of the one above, since every Prisma error class
 * extends `Error` directly) both mean the data is the problem. A
 * transaction timeout and a deadlock are the *same* class as the
 * constraint violation, different codes, and mean the database is.
 */
function isRetryable(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return RETRYABLE_PRISMA_CODES.has(error.code);
  }
  if (error instanceof Prisma.PrismaClientValidationError) return false;
  // Narrowed to one SQLSTATE, not widened to the class: everything else that
  // arrives as PrismaClientUnknownRequestError keeps the default below,
  // which is a separate decision from this one and deliberately unchanged.
  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return !CHECK_VIOLATION.test(error.message);
  }
  // PrismaClientInitializationError, PrismaClientRustPanicError, and
  // anything unrecognised default to retryable: none of these say the
  // *data* was the problem, so none of them is an honest `rejected`.
  // (applyOp itself never throws, by design and by three rounds of
  // review — this default is not covering for it.)
  return true;
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  async sync(
    userId: string,
    body: SyncRequest,
  ): Promise<{ cursor: number; results: OpResult[]; changes: Change[] }> {
    if (
      !Number.isInteger(body.since) ||
      body.since < 0 ||
      body.since > MAX_SINCE
    ) {
      throw new BadRequestException(
        `since must be an integer between 0 and ${MAX_SINCE}`,
      );
    }

    const results: OpResult[] = [];
    const now = new Date();

    for (const op of body.ops) {
      results.push(await this.applyOne(userId, op, now));
    }

    const { cursor, changes } = await this.changesSince(userId, body.since);

    return { cursor, results, changes };
  }

  private async applyOne(userId: string, op: Op, now: Date): Promise<OpResult> {
    try {
      // The whole operation is one transaction: recording the op id and
      // applying its effect must either both happen or neither, or a crash
      // between them turns a retry into a duplicate.
      return await this.prisma.$transaction(async (tx) => {
        // Before anything else, including the row locks below — see
        // lockUserWrites for why the order matters.
        await lockUserWrites(tx, userId);

        // Step 1 of the design doc's section 3: "seen before?" — a retry
        // after a lost response is a no-op, whatever today's schema thinks
        // of the op's table or field.
        // Scoped by user, not by op id alone: ids are minted by clients, so
        // the same one legitimately arrives from two accounts (see the
        // schema's note on AppliedOp). Unscoped, the second account's
        // operation reads as a duplicate of the first's — its write never
        // happens and the response calls that success.
        const seen = await tx.appliedOp.findUnique({
          where: { userId_opId: { userId, opId: op.opId } },
        });
        if (seen !== null) return replay(op.opId, seen);

        // Step 2: "Permitted?" — the table must be one this protocol
        // writes, and (for create/set) the field must be a real column.
        // This comes after step 1, not before, for the same reason: a
        // previously applied op whose table or field the schema has since
        // narrowed must still replay as itself on redelivery, not fail a
        // fresh check against today's allow-list.
        const table = TABLES.includes(op.table as TableName)
          ? (op.table as TableName)
          : null;
        const badField = table !== null ? unpermittedField(table, op) : null;

        let delegate: SyncDelegate | null = null;
        let current: Row | null = null;
        let outcome: Outcome;
        if (table === null) {
          outcome = { status: 'rejected', reason: 'unknown table' };
        } else if (badField !== null) {
          outcome = {
            status: 'rejected',
            reason: `unknown field: ${badField}`,
          };
        } else if (!UUID.test(op.id)) {
          // The contract already says `format: uuid`, and the validator
          // enforces it on the wire. This is the same check at the point
          // where it stops being cosmetic: `id` is interpolated into the
          // row lock's `::uuid` cast below, and a value Postgres cannot
          // parse there is a raw-query failure (P2010), which this service
          // treats as retryable and turns into a 5xx rather than the honest
          // per-operation rejection it is.
          outcome = { status: 'rejected', reason: 'id is not a uuid' };
        } else {
          // Before every read, not after: the locks are what make these
          // reads and the write below one cycle rather than two halves
          // another transaction can interleave with.
          await lockRows(tx, table, op, userId);
          const badReference = await referenceRejection(tx, table, op, userId);
          if (badReference !== null) {
            outcome = { status: 'rejected', reason: badReference };
          } else {
            delegate = delegateFor(tx, table);
            current = await delegate.findFirst({
              where: { id: op.id, userId },
            });
            outcome = applyOp(op, current, now);
          }
        }

        // Recorded before the row write, not after: both still land in the
        // same transaction either way, but writing appliedOp first is what
        // lets a row-write failure roll back a record that was genuinely
        // already inserted, rather than one that was never reached — a
        // constraint violation on the row can only prove atomicity if there
        // is something written earlier in the same transaction for it to
        // undo.
        await tx.appliedOp.create({
          data: {
            opId: op.opId,
            userId,
            status: outcome.status,
            reason: outcome.status === 'rejected' ? outcome.reason : null,
            currentVersion:
              outcome.status === 'conflict' ? outcome.currentVersion : null,
          },
        });

        if (outcome.status === 'applied') {
          // Guaranteed set together above: `outcome.status` can only be
          // 'applied' when the permitted-checks passed and `delegate` was
          // resolved. TS cannot see that coupling across the earlier
          // if/else, so this makes it an explicit, checked invariant
          // instead of a silent assumption.
          if (delegate === null) {
            throw new Error(
              'unreachable: applied outcome without a resolved delegate',
            );
          }
          // seq is a protocol/storage column applyOp never touches — it comes
          // from the one sequence shared by all four tables, and it has to be
          // reassigned on *every* applied write (create or update). Postgres
          // only consults a column DEFAULT on INSERT, so leaning on the
          // schema's default would silently stop advancing the cursor for
          // any `set`/`delete`, which is exactly what D15 (returning
          // tombstones) depends on.
          const [{ nextval }] = await tx.$queryRaw<[{ nextval: bigint }]>`
            SELECT nextval('change_seq') AS nextval
          `;
          const {
            id,
            version,
            fieldTs,
            deletedAt,
            seq: _seq,
            createdAt: _createdAt,
            updatedAt: _updatedAt,
            ...rest
          } = outcome.row;
          const data = {
            ...rest,
            version,
            fieldTs,
            deletedAt,
            userId,
            seq: nextval,
          };
          if (current === null) {
            await delegate.create({ data: { ...data, id } });
          } else {
            // Scoped by userId too, even though `current` was already
            // resolved through a userId-scoped findFirst above — that scope
            // should never depend on a line elsewhere staying correct.
            await delegate.update({ where: { id, userId }, data });
          }
          return { opId: op.opId, status: 'applied' as const };
        }
        if (outcome.status === 'superseded')
          return { opId: op.opId, status: 'superseded' as const };
        if (outcome.status === 'conflict') {
          return {
            opId: op.opId,
            status: 'conflict' as const,
            currentVersion: outcome.currentVersion,
          };
        }
        return {
          opId: op.opId,
          status: 'rejected' as const,
          reason: outcome.reason,
        };
      });
    } catch (error) {
      // The transaction above has already rolled back in full by the time
      // this runs, so neither the row write nor the appliedOp record exist
      // either way. What differs is what the client is told, and that is
      // decided by isRetryable — not by error class. A constraint
      // violation and a value Prisma's own validation rejects are
      // different classes (PrismaClientKnownRequestError vs.
      // PrismaClientValidationError, siblings, neither a subclass of the
      // other) but the same verdict: the data is wrong, retrying will not
      // help. A transaction timeout and a deadlock are the *same* class as
      // the constraint violation, different codes, and the opposite
      // verdict: the operation was fine, the database just could not get
      // to it this time.
      if (isRetryable(error)) {
        this.logger.error(error);
        throw error;
      }
      this.logger.warn(error);
      return {
        opId: op.opId,
        status: 'rejected',
        reason: 'could not be applied',
      };
    }
  }

  private async changesSince(
    userId: string,
    since: number,
  ): Promise<{ cursor: number; changes: Change[] }> {
    // The four tables are read inside one transaction so they share a single
    // snapshot. Read separately (the original shape of this method), a
    // write that commits between two of the reads is visible to one and not
    // the other, and a cursor built off whichever read happened to see it
    // leaves the other table's matching row below the client's `since`
    // forever — one user with two devices is enough to hit it. REPEATABLE
    // READ is what makes "one snapshot" a guarantee instead of an accident
    // of timing: Prisma's default (READ COMMITTED) lets each statement in a
    // transaction see newly committed rows from other transactions.
    //
    // The cursor itself is the max of what the scans actually returned, not
    // change_seq's own position. Sequences are not transactional in
    // Postgres, so reading change_seq inside this same REPEATABLE READ
    // transaction still returns its live, real-time value — not a
    // snapshotted one — which is always at least the max of what the scans
    // saw, and usually more: a concurrent writer that has called nextval()
    // but not yet committed already moved it. A cursor built from that
    // value can claim ground these scans never covered, on a pull that
    // returns nothing at all. Building it from delivered rows instead means
    // the residual race (an in-flight low seq *and* no higher seq visible
    // to shrink the gap) needs both conditions at once, rather than either
    // alone — see ADR 0016 for what still gets through.
    return this.prisma.$transaction(
      async (tx) => {
        // Tombstoned rows are returned on purpose: they are how a client
        // learns about a deletion, and filtering them out is silent data
        // corruption, not a missing feature (see D15).
        const out: Change[] = [];
        for (const table of TABLES) {
          const delegate = delegateFor(tx, table);
          const rows = await delegate.findMany({
            where: { userId, seq: { gt: BigInt(since) } },
            orderBy: { seq: 'asc' },
          });
          for (const row of rows) {
            out.push({
              table,
              id: String(row.id),
              seq: Number(row.seq),
              row: toChangeRow(table, row),
            });
          }
        }
        out.sort((a, b) => a.seq - b.seq);

        const cursor = out.reduce((m, c) => Math.max(m, c.seq), since);

        return { cursor, changes: out };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
