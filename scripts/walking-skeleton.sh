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

if printf '%s' "$OUT" | grep -qF "$TITLE"; then
  echo 'walking skeleton passed'
else
  echo 'FAIL: the task did not reach the second client' >&2
  printf '%s\n' "$OUT" >&2
  exit 1
fi
