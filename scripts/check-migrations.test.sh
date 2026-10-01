#!/usr/bin/env sh
# Test for check-migrations.sh. No framework: the guard has no dependencies and
# neither does its test.
set -u

here=$(dirname "$0")
subject="$here/check-migrations.sh"
failures=0

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# expect <want-exit> <description> <migration.sql body>
expect() {
  want=$1
  desc=$2
  dir="$work/case"
  rm -rf "$dir"
  mkdir -p "$dir/20260101000000_x"
  printf '%s\n' "$3" >"$dir/20260101000000_x/migration.sql"
  out=$(sh "$subject" "$dir" 2>&1)
  got=$?
  if [ "$got" -ne "$want" ]; then
    printf 'FAIL want=%s got=%s: %s\n' "$want" "$got" "$desc" >&2
    failures=$((failures + 1))
  elif [ "$want" -eq 1 ] && ! printf '%s' "$out" | grep -q 'migration.sql:'; then
    printf 'FAIL the message does not name the file: %s\n' "$desc" >&2
    failures=$((failures + 1))
  fi
}

expect 0 'clean migration' 'ALTER TABLE "Task" ADD COLUMN "note" TEXT;'
expect 1 'drops the sequence' 'DROP SEQUENCE "change_seq";'
expect 1 'drops a seq default' 'ALTER TABLE "Task" ALTER COLUMN "seq" DROP DEFAULT;'
expect 1 'lower case' 'alter table "Task" alter column "seq" drop default;'
expect 0 'drops another default' 'ALTER TABLE "Task" ALTER COLUMN "title" DROP DEFAULT;'

# The real migrations must stay clean.
if ! sh "$subject" >/dev/null 2>&1; then
  echo 'FAIL the repository migrations trip the guard' >&2
  failures=$((failures + 1))
fi

# Called wrong
sh "$subject" "$work/missing" >/dev/null 2>&1
[ "$?" -eq 2 ] || { echo 'FAIL a missing directory must exit 2' >&2; failures=$((failures + 1)); }

if [ "$failures" -gt 0 ]; then
  printf '%s failing case(s)\n' "$failures" >&2
  exit 1
fi
echo 'all cases pass'
