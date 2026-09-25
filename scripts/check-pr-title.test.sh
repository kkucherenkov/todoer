#!/usr/bin/env sh
# Table test for check-pr-title.sh. No framework: the gate has no dependencies
# and neither does its test.
set -u

here=$(dirname "$0")
subject="$here/check-pr-title.sh"
failures=0

expect() {
  want=$1
  title=$2
  sh "$subject" "$title" >/dev/null 2>&1
  got=$?
  if [ "$got" -ne "$want" ]; then
    printf 'FAIL want=%s got=%s title=%s\n' "$want" "$got" "$title" >&2
    failures=$((failures + 1))
  fi
}

# Accepted
expect 0 'feat: add calendar view'
expect 0 'fix(web): stop the list from collapsing'
expect 0 'feat(api)!: drop the v1 endpoints'
expect 0 'revert: feat(api): add pagination'
expect 0 'chore(deps): bump node to 22'
expect 0 'docs: explain the sync model'

# Accepted: the scope is unconstrained. Conventional Commits does not restrict
# its characters, and a project whose packages are named `UI` or whose scope is
# `Dockerfile` must not be told its correct title is wrong.
expect 0 'fix(API): uppercase scope'
expect 0 'feat(Button): component scope'
expect 0 'chore(Dockerfile): bump the base image'
expect 0 'feat(api,web): two scopes'

# Rejected: unknown type
expect 1 'feature: add calendar view'
expect 1 'Add calendar view'
expect 1 'FEAT: add calendar view'

# Rejected: no description
expect 1 'feat:'
expect 1 'feat: '
expect 1 'feat:  '
expect 1 'feat:add calendar view'

# Rejected: a title is one line. `grep` anchors ^ to a LINE, so a multi-line
# string whose SECOND line is conventional would otherwise be accepted whole.
expect 1 "$(printf 'Merge pull request #12\nfeat: sneaky')"
expect 1 "$(printf 'feat: fine\nrm -rf /')"

# Length boundary. Build the strings instead of typing them: a literal run of
# 66 versus 67 'a' characters is a transcription risk, and a miscounted
# fixture fails in a way that looks like a bug in the gate.
pad() {
  i=0
  s=''
  while [ "$i" -lt "$1" ]; do
    s="${s}a"
    i=$((i + 1))
  done
  printf '%s' "$s"
}

expect 0 "feat: $(pad 66)"   # 'feat: ' is 6 chars, so this is exactly 72
expect 1 "feat: $(pad 67)"   # 73, one over

# The limit is in CHARACTERS, not bytes, and it has to hold under the shell CI
# actually uses. `/bin/sh` on a GitHub runner is dash, whose ${#var} counts
# bytes; the same expression under bash in a UTF-8 locale counts characters.
# So these cases are pinned to LC_ALL=C, which reproduces the byte-counting
# behaviour on any shell. Without the pin they pass locally and fail in CI —
# which is precisely the bug.
expect_c() {
  want=$1
  title=$2
  LC_ALL=C sh "$subject" "$title" >/dev/null 2>&1
  got=$?
  if [ "$got" -ne "$want" ]; then
    printf 'FAIL (LC_ALL=C) want=%s got=%s title=%s\n' "$want" "$got" "$title" >&2
    failures=$((failures + 1))
  fi
}

# 'feat: ' + 63 ASCII + 3 em dashes = 72 characters, 78 bytes.
multibyte_at_limit="feat: $(pad 63)———"
# One more ASCII character: 73 characters, 79 bytes.
multibyte_over_limit="feat: $(pad 64)———"

expect   0 "$multibyte_at_limit"
expect_c 0 "$multibyte_at_limit"
expect   1 "$multibyte_over_limit"
expect_c 1 "$multibyte_over_limit"

# Shell metacharacters are text, never code.
#
# The type has to be VALID. With `oops:` the pattern rejects the title before
# anything else runs, so the case proves the regex works and says nothing about
# whether an accepted title is ever evaluated — which is the property being
# asserted. Each payload below is carried by a title the gate ACCEPTS.
#
# The marker lives in a private directory rather than at a fixed /tmp path: a
# leftover file from another user, or another run, would otherwise report "the
# gate executed its input" when it did no such thing.
marker_dir=$(mktemp -d)
trap 'rm -rf "$marker_dir"' EXIT
marker="$marker_dir/p"

check_not_executed() {
  desc=$1
  title=$2
  want=$3
  rm -f "$marker"
  expect "$want" "$title"
  if [ -e "$marker" ]; then
    printf 'FAIL the gate executed its input (%s)\n' "$desc" >&2
    failures=$((failures + 1))
  fi
}

check_not_executed 'command substitution'  "feat: add \$(touch $marker) support" 0
check_not_executed 'backticks'             "feat: add \`touch $marker\` support" 0
check_not_executed 'statement separator'   "feat: x; touch $marker" 0
check_not_executed 'rejected before match' "oops: \$(touch $marker)" 1

# Called wrong
expect 2 ''

if [ "$failures" -gt 0 ]; then
  printf '%s failing case(s)\n' "$failures" >&2
  exit 1
fi
echo 'all cases pass'
