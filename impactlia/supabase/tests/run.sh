#!/bin/sh
# Applies every migration to a scratch database on the local Postgres and runs
# the SQL checks in this folder against it. Run with `pnpm check:database`.
#
# Nothing here touches the Supabase project: it needs only a local Postgres
# that the current user can create databases on. The scratch database is
# dropped afterwards whatever happens, and so are the two roles if this run
# was what created them.
set -eu
cd "$(dirname "$0")/.."

database="impactlia_check_$$"
created_roles=""
run() { psql -X -q -v ON_ERROR_STOP=1 -d "$database" "$@"; }

cleanup() {
  dropdb --if-exists "$database"
  for role in $created_roles; do
    psql -X -q -d postgres -c "drop role if exists $role" || true
  done
}
trap cleanup EXIT

for role in anon authenticated; do
  if [ "$(psql -X -At -d postgres -c "select 1 from pg_roles where rolname = '$role'")" != "1" ]; then
    psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "create role $role nologin"
    created_roles="$created_roles $role"
  fi
done

createdb "$database"
run -f tests/local-stubs.sql
for migration in migrations/*.sql; do
  echo "applying $migration"
  run -f "$migration"
done
for check in tests/*.test.sql; do
  echo "running $check"
  run -o /dev/null -f "$check"
done
echo "database checks passed"
