#!/usr/bin/env sh
# Fail when a migration undoes the hand-written `seq` defaults or the
# `change_seq` sequence (trap 6 in .claude/CLAUDE.md). `prisma migrate dev`
# models neither, so every generated migration proposes dropping them; applied,
# that breaks the sync cursor. The statements must be deleted by hand, and this
# is the check that notices when someone forgot.
set -eu

dir=${1:-$(dirname "$0")/../apps/backend/prisma/migrations}

if [ ! -d "$dir" ]; then
  echo "usage: check-migrations.sh [migrations-dir] (not a directory: $dir)" >&2
  exit 2
fi

status=0
for file in "$dir"/*/migration.sql; do
  [ -e "$file" ] || continue
  # Any whitespace between the words, and SQL comment lines do not count.
  hits=$(grep -inE 'DROP[[:space:]]+SEQUENCE[[:space:]]+"change_seq"|"seq"[[:space:]]+DROP[[:space:]]+DEFAULT' "$file" |
    grep -vE '^[0-9]+:[[:space:]]*--' || true)
  if [ -n "$hits" ]; then
    printf '%s\n' "$hits" | sed "s|^|$file:|" >&2
    status=1
  fi
done

if [ "$status" -ne 0 ]; then
  echo 'error: a migration drops change_seq or a seq default; delete those statements (trap 6 in .claude/CLAUDE.md)' >&2
fi
exit "$status"
