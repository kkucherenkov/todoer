#!/bin/sh
# POSIX sh (trap 4). Migrate, then replace the shell so signals reach node.
set -eu
node_modules/.bin/prisma migrate deploy
exec node dist/main.js
