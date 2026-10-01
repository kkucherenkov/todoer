#!/usr/bin/env sh
# The claim this plan exists to prove: a task created through the CLI reaches a
# second, independent CLI invocation through the server — no shared process, no
# shared memory, only POST /sync.
set -eu

BASE=${TODOER_URL:-http://localhost:3000/api/v1}
EMAIL="skeleton-$(date +%s)@example.test"
PASSWORD="correct horse 9 battery!"
TITLE="walking skeleton $(date +%s)"

# Owner-aware sign-up: see the helper's header.
. scripts/lib/fresh-user.sh

# Two separate state files: writer and reader must not share local state, or
# the test proves only that a file was written.
WRITER=$(mktemp -d)
READER=$(mktemp -d)
trap 'rm -rf "$WRITER" "$READER"' EXIT

HOME="$WRITER" TODOER_TOKEN="$TOKEN" node apps/cli/dist/index.js add "$TITLE" >/dev/null
OUT=$(HOME="$READER" TODOER_TOKEN="$TOKEN" node apps/cli/dist/index.js list)

printf '%s' "$OUT" | grep -qF "$TITLE" || {
  echo 'FAIL: the task did not reach the second client' >&2
  printf '%s\n' "$OUT" >&2
  exit 1
}

# Quick-add labels (#362): a tag created in one replica filters the second's
# list, through the server alone.
TAG="@skeleton$(date +%s)"
LTITLE="tagged $(date +%s)"
HOME="$WRITER" TODOER_TOKEN="$TOKEN" node apps/cli/dist/index.js add "$LTITLE $TAG" >/dev/null
TAGGED=$(HOME="$READER" TODOER_TOKEN="$TOKEN" node apps/cli/dist/index.js list "$TAG")
printf '%s' "$TAGGED" | grep -qF "$LTITLE" || {
  echo "FAIL: list $TAG in the second client did not find the tagged task" >&2
  printf '%s\n' "$TAGGED" >&2
  exit 1
}
# ...and only that one: a list that ignored its filter would show both.
if printf '%s' "$TAGGED" | grep -qF "$TITLE"; then
  echo "FAIL: list $TAG showed the untagged task" >&2
  printf '%s\n' "$TAGGED" >&2
  exit 1
fi

# Recurrence (plan C1): a daily task marked done in one replica shows at
# another date in the second, through the server alone. `date +%Y-%m-%d` is
# the same local date the CLI calls today.
RTITLE="recurring $(date +%s)"
TODAY=$(date +%Y-%m-%d)
ADDED=$(HOME="$WRITER" TODOER_TOKEN="$TOKEN" node apps/cli/dist/index.js add "$RTITLE" --rrule FREQ=DAILY --json)
RID=$(printf '%s' "$ADDED" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
[ -n "$RID" ] || { echo "FAIL: add --json printed no id: $ADDED" >&2; exit 1; }
HOME="$WRITER" TODOER_TOKEN="$TOKEN" node apps/cli/dist/index.js done "$RID" >/dev/null
LINE=$(HOME="$READER" TODOER_TOKEN="$TOKEN" node apps/cli/dist/index.js list | grep -F "$RTITLE" || true)
case $LINE in
  '') echo 'FAIL: the recurring task did not reach the second client' >&2; exit 1 ;;
  *"$TODAY"*) echo "FAIL: the second client still shows today's date: $LINE" >&2; exit 1 ;;
esac

# Views (plan V2): a status and a view go through POST /sync, so the
# contract's table enum and the filter check are exercised over HTTP.
SID=$(node -e 'console.log(crypto.randomUUID())')
VID=$(node -e 'console.log(crypto.randomUUID())')
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
op() { printf '{"opId":"%s","kind":"create","table":"%s","id":"%s","fields":%s,"ts":"%s"}' \
  "$(node -e 'console.log(crypto.randomUUID())')" "$1" "$2" "$3" "$NOW"; }
STATUS_OP=$(op status "$SID" '{"name":"Doing","rank":"a1","completing":false}')
VIEW_OP=$(op view "$VID" "{\"name\":\"Doing now\",\"layout\":\"kanban\",\"sort\":\"manual\",\"rank\":\"a0\",\"filter\":{\"status\":\"$SID\"}}")
BAD_OP=$(op view "$(node -e 'console.log(crypto.randomUUID())')" '{"name":"bad","layout":"list","sort":"due","rank":"a1","filter":{"tag":"x"}}')
api /sync "{\"since\":0,\"ops\":[$STATUS_OP,$VIEW_OP,$BAD_OP]}" "$TOKEN"
[ "$STATUS" = 200 ] || { echo "FAIL: /sync with a status and a view returned $STATUS: $BODY_OUT" >&2; exit 1; }
APPLIED=$(printf '%s' "$BODY_OUT" | grep -o '"status":"applied"' | wc -l)
[ "$APPLIED" -eq 2 ] || { echo "FAIL: expected the status and the view applied: $BODY_OUT" >&2; exit 1; }
printf '%s' "$BODY_OUT" | grep -qF 'filter.tag: not a uuid' ||
  { echo "FAIL: the invalid filter was not rejected with its reason: $BODY_OUT" >&2; exit 1; }

# The CLI's own sign-in: no TODOER_TOKEN, only what `login` stored.
SIGNED=$(mktemp -d)
unset TODOER_TOKEN
trap 'rm -rf "$WRITER" "$READER" "$SIGNED"' EXIT
HOME="$SIGNED" TODOER_PASSWORD="$PASSWORD" node apps/cli/dist/index.js login "$EMAIL" >/dev/null ||
  { echo 'FAIL: todoer login failed' >&2; exit 1; }
HOME="$SIGNED" node apps/cli/dist/index.js list | grep -qF "$TITLE" || {
  echo 'FAIL: a command after login, without TODOER_TOKEN, did not see the task' >&2
  exit 1
}

echo 'walking skeleton passed'
