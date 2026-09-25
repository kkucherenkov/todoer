#!/usr/bin/env sh
# Create a throwaway repository from the published template, assert the
# skeleton arrived intact, then delete it.
#
# This runs against the REMOTE template, not the local working tree: the thing
# under test is what `gh repo create --template` actually hands a person.
set -eu

# This script tests the template. `gh repo create --template` copies every
# tracked file, so it lands in each repository made from the skeleton, where it
# has nothing to test and would create and delete repositories in that owner's
# account against someone else's template. Refuse rather than do that.
origin=$(git config --get remote.origin.url 2>/dev/null || true)
case ${origin:-} in
  *project-skeleton*) : ;;
  *)
    echo 'error: this script tests the project-skeleton template itself.' >&2
    echo 'In a repository created from it there is nothing to test — delete this file.' >&2
    exit 2
    ;;
esac

name="skeleton-smoke-$(date +%s)"
owner=$(gh api user --jq .login)
work=$(mktemp -d)
failures=0

cleanup() {
  if ! gh repo delete "$owner/$name" --yes >/dev/null 2>&1; then
    # Not swallowed: a delete that fails silently leaves a repository behind on
    # every run, and the next person to look finds a dozen of them. The usual
    # cause is a token without the scope, which is one command to fix.
    printf 'WARN could not delete %s/%s — delete it by hand.\n' "$owner" "$name" >&2
    printf 'WARN for automatic cleanup: gh auth refresh -h github.com -s delete_repo\n' >&2
  fi
  rm -rf "$work"
}
trap cleanup EXIT

# `check` and `check_fails` take a COMMAND, not an exit status. Under `set -e`
# a bare `test -f x` that fails terminates the script before anything is
# printed — a run that asserts nothing and looks like a quiet success. Running
# the command inside `if` is the one place `set -e` stands down.
check() {
  desc=$1
  shift
  if "$@" >/dev/null 2>&1; then
    printf 'ok   %s\n' "$desc"
  else
    printf 'FAIL %s\n' "$desc" >&2
    failures=$((failures + 1))
  fi
}

check_fails() {
  desc=$1
  shift
  if "$@" >/dev/null 2>&1; then
    printf 'FAIL %s\n' "$desc" >&2
    failures=$((failures + 1))
  else
    printf 'ok   %s\n' "$desc"
  fi
}

gh repo create "$name" --private --template "$owner/project-skeleton" >/dev/null

# GitHub copies a template asynchronously: `gh repo create --template` returns
# before the files exist, and an immediate clone reports "you appear to have
# cloned an empty repository". Observed on this script's first run.
#
# Clone over https explicitly rather than with `gh repo create --clone`, which
# picks a protocol of its own: on this machine it chose ssh, and there is no
# GitHub ssh key, so the equivalent push failed with exit 128.
attempt=1
while [ "$attempt" -le 10 ]; do
  rm -rf "$work/$name"
  git clone --quiet "https://github.com/$owner/$name.git" "$work/$name" 2>/dev/null || true
  if [ -f "$work/$name/README.md" ]; then
    break
  fi
  attempt=$((attempt + 1))
  sleep 2
done

if [ ! -f "$work/$name/README.md" ]; then
  echo "error: the template's content never appeared after ~20s" >&2
  exit 1
fi

cd "$work/$name"

check "CLAUDE.md present"            test -f .claude/CLAUDE.md
check "specs/tasks/active present"   test -d specs/tasks/active
check "specs/tasks/done present"     test -d specs/tasks/done
check "pr-title workflow present"    test -f .github/workflows/pr-title.yml

# The gate must work in the new repository with nothing installed.
check       "title gate accepts a valid subject" sh scripts/check-pr-title.sh 'feat: works in a fresh clone'
check_fails "title gate rejects an invalid subject" sh scripts/check-pr-title.sh 'nope'

# Placeholders must survive publication, so the person filling them cannot miss
# one. Asserted BY NAME across the whole tree, not by counting two files: a
# threshold survives the loss of any individual placeholder, changes whenever
# the template gains a field, and skips `docs/adr/0001` entirely.
for ph in '<PROJECT>' '<LANG>' '<SUMMARY>' '<DATE>'; do
  check "placeholder $ph survived publication" \
    grep -rqF "$ph" --exclude-dir=.git .
done

# The other half: nothing may match the setup grep that is NOT a placeholder,
# or a person following the documented command is sent to edit prose. This is
# not hypothetical — a sentence explaining the placeholder convention matched
# its own description once.
unexpected=$(grep -rho '<[A-Z_]\+>' --exclude-dir=.git . \
  | sort -u \
  | grep -vxE '<PROJECT>|<LANG>|<SUMMARY>|<DATE>' || true)
if [ -z "$unexpected" ]; then
  printf 'ok   the setup grep matches placeholders and nothing else\n'
else
  printf 'FAIL the setup grep also matches: %s\n' "$(printf '%s' "$unexpected" | tr '\n' ' ')" >&2
  failures=$((failures + 1))
fi

# No project nouns from the repository the skeleton was extracted from.
# smoke-test.sh is excluded because it carries this very pattern as a literal,
# and would otherwise match itself on every run after it is published.
check_fails "no source-project nouns" \
  grep -rqniE 'course.?shelf|@app/|centrifugo' . --exclude-dir=.git --exclude=smoke-test.sh

if [ "$failures" -gt 0 ]; then
  printf '%s failing check(s)\n' "$failures" >&2
  exit 1
fi
echo 'smoke test passed'
