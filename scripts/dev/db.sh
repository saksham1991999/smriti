#!/usr/bin/env bash
# Local Postgres 16 + Redis for Smriti development (docs/TRD.md §17 "local").
#
#   scripts/dev/db.sh up      start Postgres (port 54322) and Redis (port 56379); create the DBs on first run
#   scripts/dev/db.sh reset   drop and recreate `smriti` and `smriti_test`, apply every migration and the seed
#   scripts/dev/db.sh down    stop both
#   scripts/dev/db.sh status  show what is running
#   scripts/dev/db.sh psql    open psql on the dev database
#
# There is no Supabase stack here, so supabase/local/*.sql adds the Supabase roles and a
# small `auth` schema shim before the migrations run. Those files never go to production.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEV="$ROOT/.dev"
PGDATA="$DEV/pg"
PGRUN="$DEV/run"
PGLOG="$DEV/postgres.log"
REDIS_DIR="$DEV/redis"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGPORT="${PGPORT:-54322}"
REDIS_PORT="${REDIS_PORT:-56379}"
# SMRITI_DB_NAME lets two worktrees share one Postgres without dropping each other's databases
# (for example SMRITI_DB_NAME=smriti_a gives smriti_a and smriti_a_test; point DATABASE_URL at them).
DB_NAME="${SMRITI_DB_NAME:-smriti}"
DB_NAMES=("$DB_NAME" "${DB_NAME}_test")

log() { printf '\033[1;32m[db]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[db]\033[0m %s\n' "$*" >&2; }

# Postgres refuses to run as root; inside containers we run it as the `postgres` OS user.
as_pg() {
  if [ "$(id -u)" = "0" ]; then
    runuser -u postgres -- "$@"
  else
    "$@"
  fi
}

psql_admin() {
  PGPASSWORD=postgres "$PGBIN/psql" -h 127.0.0.1 -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 -q "$@"
}

pg_running() {
  "$PGBIN/pg_isready" -h 127.0.0.1 -p "$PGPORT" -q >/dev/null 2>&1
}

init_cluster() {
  if [ -f "$PGDATA/PG_VERSION" ]; then
    return
  fi
  log "initialising Postgres cluster in $PGDATA"
  mkdir -p "$PGDATA" "$PGRUN"
  if [ "$(id -u)" = "0" ]; then
    chown -R postgres:postgres "$PGDATA" "$PGRUN"
    chmod 755 "$DEV"
  fi
  # Local only: trust auth on localhost.
  as_pg "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null
  {
    echo "listen_addresses = '127.0.0.1'"
    echo "port = $PGPORT"
    echo "unix_socket_directories = '$PGRUN'"
    echo "max_connections = 200"
    echo "fsync = off"
    echo "synchronous_commit = off"
    echo "timezone = 'UTC'"
  } | as_pg tee -a "$PGDATA/postgresql.conf" >/dev/null
}

start_pg() {
  if pg_running; then
    log "Postgres already running on port $PGPORT"
    return
  fi
  touch "$PGLOG"
  [ "$(id -u)" = "0" ] && chown postgres:postgres "$PGLOG"
  as_pg "$PGBIN/pg_ctl" -D "$PGDATA" -l "$PGLOG" -w -t 30 start >/dev/null
  log "Postgres started on 127.0.0.1:$PGPORT"
}

start_redis() {
  if redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1; then
    log "Redis already running on port $REDIS_PORT"
    return
  fi
  mkdir -p "$REDIS_DIR"
  redis-server --port "$REDIS_PORT" --bind 127.0.0.1 --dir "$REDIS_DIR" \
    --save "" --appendonly no --daemonize yes --logfile "$DEV/redis.log" \
    --pidfile "$DEV/redis.pid" >/dev/null
  for _ in $(seq 1 50); do
    redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1 && break
    sleep 0.1
  done
  log "Redis started on 127.0.0.1:$REDIS_PORT"
}

apply_sql() {
  local db="$1" file="$2" level="${3:-notice}"
  # NOTICEs (for example "pgvector not available") are printed, so they are visible in the log.
  PGOPTIONS="--client-min-messages=$level" psql_admin -d "$db" -o /dev/null -f "$file"
}

build_db() {
  local db="$1"
  log "creating database $db"
  psql_admin -d postgres -c "drop database if exists $db with (force)"
  psql_admin -d postgres -c "create database $db"
  psql_admin -d "$db" -c "alter database $db set search_path = \"\$user\", public, extensions"
  for f in "$ROOT"/supabase/local/*.sql; do
    apply_sql "$db" "$f" warning
  done
  local count=0
  for f in "$ROOT"/supabase/migrations/*.sql; do
    apply_sql "$db" "$f"
    count=$((count + 1))
  done
  if [ -f "$ROOT/supabase/seed.sql" ]; then
    apply_sql "$db" "$ROOT/supabase/seed.sql"
  fi
  log "$db: $count migrations applied, seed loaded"
}

db_exists() {
  psql_admin -d postgres -tAc "select 1 from pg_database where datname = '$1'" | grep -q 1
}

cmd_up() {
  mkdir -p "$DEV"
  init_cluster
  start_pg
  start_redis
  for db in "${DB_NAMES[@]}"; do
    if ! db_exists "$db"; then
      build_db "$db"
    fi
  done
  log "DATABASE_URL=postgresql+asyncpg://postgres:postgres@127.0.0.1:$PGPORT/$DB_NAME"
  log "REDIS_URL=redis://127.0.0.1:$REDIS_PORT/0"
}

cmd_reset() {
  mkdir -p "$DEV"
  init_cluster
  start_pg
  start_redis
  for db in "${DB_NAMES[@]}"; do
    build_db "$db"
  done
  # A named pair shares Redis with other worktrees, so only the default reset flushes it.
  if [ "$DB_NAME" = "smriti" ]; then
    redis-cli -p "$REDIS_PORT" flushall >/dev/null
  fi
  log "reset done"
}

cmd_down() {
  if pg_running; then
    as_pg "$PGBIN/pg_ctl" -D "$PGDATA" -m fast -w stop >/dev/null && log "Postgres stopped"
  fi
  if redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1; then
    redis-cli -p "$REDIS_PORT" shutdown nosave >/dev/null 2>&1 || true
    log "Redis stopped"
  fi
}

cmd_status() {
  if pg_running; then log "Postgres: running on $PGPORT"; else warn "Postgres: stopped"; fi
  if redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1; then log "Redis: running on $REDIS_PORT"; else warn "Redis: stopped"; fi
}

case "${1:-}" in
  up) cmd_up ;;
  reset) cmd_reset ;;
  down) cmd_down ;;
  status) cmd_status ;;
  psql) shift; psql_admin -d "$DB_NAME" "$@" ;;
  *)
    echo "usage: $0 up|reset|down|status|psql" >&2
    exit 2
    ;;
esac
