# Sourced by the e2e scripts: `. scripts/lib/fresh-user.sh`. POSIX sh.
#
# Registration is owner-first, so a script cannot simply register a throwaway
# user: it signs in as the owner (registering the owner on an empty instance),
# issues an invitation and registers a fresh user with it.
#
# In:  BASE, EMAIL and PASSWORD (the fresh user's, set by the caller);
#      OWNER_EMAIL and OWNER_PASSWORD, defaulting to the values below.
# Out: TOKEN, the fresh user's access token.
#
# Budget: per run this makes 2 registrations and 1 login. The server counts
# every login and registration per IP, win or lose (20 per 15 minutes each).

OWNER_EMAIL=${OWNER_EMAIL:-owner@example.test}
OWNER_PASSWORD=${OWNER_PASSWORD:-correct horse 9 battery!}

# api PATH BODY [BEARER] — sets STATUS and BODY_OUT. Captured and split rather
# than piped, so a curl failure is not hidden behind the pipe's exit status.
api() {
  # A harmless header stands in when there is no bearer: "$AUTH" stays one word.
  AUTH="x-e2e: 1"
  [ -z "${3:-}" ] || AUTH="authorization: Bearer $3"
  _resp=$(curl -s -w '\n%{http_code}' -X POST "$BASE$1" \
    -H 'content-type: application/json' -H "$AUTH" \
    -d "$2") ||
    { echo "FAIL: POST $1 could not reach $BASE" >&2; exit 1; }
  STATUS=$(printf '%s' "$_resp" | tail -n 1)
  BODY_OUT=$(printf '%s' "$_resp" | sed '$d')
}

# json_field NAME — the string value of NAME in BODY_OUT.
json_field() {
  printf '%s' "$BODY_OUT" | sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p"
}

OWNER_CREDS="{\"email\":\"$OWNER_EMAIL\",\"password\":\"$OWNER_PASSWORD\"}"
api /auth/register "$OWNER_CREDS"
if [ "$STATUS" != 201 ]; then
  api /auth/login "$OWNER_CREDS"
  [ "$STATUS" = 200 ] || {
    echo "FAIL: the instance has an owner and logging in as $OWNER_EMAIL returned $STATUS;" \
      'set OWNER_EMAIL and OWNER_PASSWORD to the owner credentials' >&2
    exit 1
  }
fi
OWNER_TOKEN=$(json_field accessToken)
[ -n "$OWNER_TOKEN" ] || { echo 'FAIL: no owner access token' >&2; exit 1; }

api /auth/invites '{}' "$OWNER_TOKEN"
[ "$STATUS" = 201 ] || { echo "FAIL: issuing an invitation returned $STATUS" >&2; exit 1; }
INVITATION=$(json_field token)
[ -n "$INVITATION" ] || { echo 'FAIL: no invitation token' >&2; exit 1; }

api /auth/register \
  "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"invitation\":\"$INVITATION\"}"
[ "$STATUS" = 201 ] || { echo "FAIL: registering $EMAIL returned $STATUS" >&2; exit 1; }
TOKEN=$(json_field accessToken)
[ -n "$TOKEN" ] || { echo 'FAIL: no access token for the new user' >&2; exit 1; }
