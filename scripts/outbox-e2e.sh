#!/usr/bin/env sh
# The outbox, end to end, against a live server: operations queued with no
# server reach it on a later command with their original ids, parallel
# invocations lose nothing, and a cursor older than the prune watermark
# recovers through a snapshot. POSIX sh — see the walking skeleton's header.
set -eu

BASE=${TODOER_URL:-http://localhost:3000/api/v1}
: "${DATABASE_URL:?DATABASE_URL must name the database the backend uses}"
EMAIL="outbox-$(date +%s)-$$@example.test"
PASSWORD="correct horse battery staple"
CLI="node apps/cli/dist/index.js"
# Port 9 (discard): nothing listens there, so the connection is refused.
UNREACHABLE=http://127.0.0.1:9/api/v1

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# field EXPR — evaluates EXPR against the JSON object on stdin, as `v`.
field() {
  node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s);console.log(JSON.stringify($1))})"
}

curl -sf -X POST "$BASE/auth/register" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" >/dev/null
LOGIN=$(curl -sf -X POST "$BASE/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
TOKEN=$(printf '%s' "$LOGIN" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
[ -n "$TOKEN" ] || fail 'could not obtain a token'
export TODOER_TOKEN="$TOKEN"

WRITER=$(mktemp -d)
READER=$(mktemp -d)
CODES=$(mktemp -d)
trap 'rm -rf "$WRITER" "$READER" "$CODES"' EXIT

# 1. Ten adds at once with no server: each is queued and exits 5, and the
#    outbox holds all ten — the reason the replica is SQLite.
i=1
while [ "$i" -le 10 ]; do
  (
    set +e
    HOME="$WRITER" TODOER_URL=$UNREACHABLE $CLI add "offline $i" --json >/dev/null 2>&1
    echo $? >"$CODES/$i"
  ) &
  i=$((i + 1))
done
wait
for f in "$CODES"/*; do
  [ "$(cat "$f")" = 5 ] || fail "an offline add exited $(cat "$f"), not 5"
done

set +e
QUEUED=$(HOME="$WRITER" TODOER_URL=$UNREACHABLE $CLI outbox --json 2>/dev/null)
rc=$?
set -e
[ "$rc" = 5 ] || fail "the offline outbox command exited $rc, not 5"
[ "$(printf '%s' "$QUEUED" | field 'v.outbox.pending')" = 10 ] ||
  fail "the outbox does not hold 10 operations: $QUEUED"

# 2. Back online: the next command delivers all ten, and a second client
#    with its own replica sees them.
HOME="$WRITER" TODOER_URL="$BASE" $CLI list --json >/dev/null ||
  fail 'the first online command did not exit 0'
PENDING=$(HOME="$WRITER" TODOER_URL="$BASE" $CLI outbox --json | field 'v.outbox.pending')
[ "$PENDING" = 0 ] || fail "$PENDING operations still queued after an online command"
SEEN=$(HOME="$READER" TODOER_URL="$BASE" $CLI list --json |
  field "v.data.filter(t => t.title.startsWith('offline ')).length")
[ "$SEEN" = 10 ] || fail "the second client sees $SEEN of the 10 queued tasks"

# 3. A stale cursor, with a tombstone the writer must actually discard, not
#    merely fail to notice. One of the writer's own tasks is hard-deleted on
#    the server — as pruning would once its tombstone ages out — so the
#    writer's replica now holds a row the server no longer has. The reader
#    then writes once more, so the user's newest seq (that add) stays above
#    the writer's cursor regardless of the deletion; moving the watermark
#    there makes the writer's cursor older than what was pruned — 410 — and
#    the writer must recover with a snapshot that keeps everything else and
#    drops the row that is gone. A resend-since-0 that skips discarding the
#    replica would instead merge the snapshot over the stale row and leave it
#    behind.
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -c "
  DELETE FROM \"Task\"
   WHERE \"userId\" = (SELECT id FROM \"User\" WHERE email = '$EMAIL')
     AND title = 'offline 1'"
HOME="$READER" TODOER_URL="$BASE" $CLI add 'after the writer' >/dev/null
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -c "
  UPDATE \"User\" u
     SET \"prunedThroughSeq\" = (SELECT max(seq) FROM \"Task\" t WHERE t.\"userId\" = u.id)
   WHERE u.email = '$EMAIL'"
AFTER=$(HOME="$WRITER" TODOER_URL="$BASE" $CLI list --json) ||
  fail 'the list after the watermark moved did not exit 0'
[ "$(printf '%s' "$AFTER" | field "v.data.length")" = 10 ] ||
  fail "the snapshot does not hold the 10 surviving tasks: $AFTER"
HELD=$(printf '%s' "$AFTER" | field "v.data.some(t => t.title === 'offline 1')")
[ "$HELD" = 'false' ] ||
  fail "the snapshot still holds the deleted task: $AFTER"
HOME="$WRITER" TODOER_URL="$BASE" $CLI list >/dev/null ||
  fail 'the command after the snapshot did not exit 0'

echo 'outbox e2e passed'
