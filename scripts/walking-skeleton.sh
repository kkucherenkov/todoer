#!/usr/bin/env sh
# The claim this plan exists to prove: a task created through the CLI reaches a
# second, independent CLI invocation through the server — no shared process, no
# shared memory, only POST /sync.
set -eu

BASE=${TODOER_URL:-http://localhost:3000/api/v1}
EMAIL="skeleton-$(date +%s)@example.test"
PASSWORD="correct horse battery staple"
TITLE="walking skeleton $(date +%s)"

curl -sf -X POST "$BASE/auth/register" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" >/dev/null

# Captured, then parsed, rather than piped straight into sed: a pipe makes the
# exit status sed's, so `set -e` would not see curl fail. `set -o pipefail`
# fixes that in bash but is not POSIX — dash rejected it until 0.5.12 — and
# this script's shebang is `sh`, so it would abort on the shell rather than on
# the failure it was added to catch.
LOGIN=$(curl -sf -X POST "$BASE/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
TOKEN=$(printf '%s' "$LOGIN" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')

[ -n "$TOKEN" ] || { echo 'could not obtain a token' >&2; exit 1; }

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
HOME="$WRITER" TODOER_TOKEN="$TOKEN" node apps/cli/dist/index.js add "$LTITLE $TAG" >/dev/null 2>&1
TAGGED=$(HOME="$READER" TODOER_TOKEN="$TOKEN" node apps/cli/dist/index.js list "$TAG")
printf '%s' "$TAGGED" | grep -qF "$LTITLE" || {
  echo "FAIL: list $TAG in the second client did not find the tagged task" >&2
  printf '%s\n' "$TAGGED" >&2
  exit 1
}

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

echo 'walking skeleton passed'
