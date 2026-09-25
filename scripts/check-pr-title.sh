#!/usr/bin/env sh
# Validate a Conventional Commits subject line.
#
# No Node, no package manager, no install step: this gate runs in repositories
# that have not chosen a stack yet, and it must not be the reason one is
# chosen. The title arrives as "$1" and is only ever matched against, never
# evaluated — a PR title is author-controlled text.
set -u

max=72
types='feat|fix|chore|docs|refactor|test|perf|ci|build|style|revert'

# The scope is deliberately unconstrained apart from parentheses. Conventional
# Commits does not restrict its characters, and a project with a package named
# `UI`, or a scope of `Dockerfile`, or two scopes as `api,web`, must not be
# told its correct title is wrong. A gate that rejects valid input teaches
# people to bypass the gate.
pattern="^($types)(\([^()]+\))?!?: [^[:space:]]"

if [ "$#" -ne 1 ] || [ -z "$1" ]; then
  echo 'usage: check-pr-title.sh "<title>"' >&2
  exit 2
fi

title=$1

# A title is one line. `grep` anchors `^` to a LINE, not to the input, so a
# multi-line string whose second line happens to be conventional would satisfy
# the pattern while its actual subject does not.
if [ "$(printf '%s' "$title" | wc -l | tr -d ' ')" -ne 0 ]; then
  echo 'error: a PR title is a single line' >&2
  exit 1
fi

if ! printf '%s' "$title" | grep -Eq "$pattern"; then
  echo "error: not a Conventional Commits subject: $title" >&2
  echo 'expected: type(scope)?!?: description' >&2
  echo "types: $types" >&2
  echo 'the description must follow exactly one space and start with a non-space' >&2
  exit 1
fi

# The limit is in CHARACTERS. `${#title}` counts BYTES under dash, which is
# `/bin/sh` on a GitHub runner, so a title containing an em dash or an accented
# letter is rejected for a length it does not have — and the message names a
# number the author cannot count. `wc -m` counts characters, but only in a
# UTF-8 locale, so the locale is forced rather than inherited. Where C.UTF-8 is
# unavailable this degrades to counting bytes, which is today's behaviour.
length=$(printf '%s' "$title" | LC_ALL=C.UTF-8 wc -m 2>/dev/null | tr -d ' ')
if [ "$length" -gt "$max" ]; then
  echo "error: subject is $length characters, limit is $max" >&2
  exit 1
fi

exit 0
