#!/usr/bin/env bash
# One-command local stack as native processes (docs/LOCAL_DEV.md). Docker is not needed.
#
#   scripts/dev/stack.sh            reset the stack database, publish content/, start API, worker, web
#   scripts/dev/stack.sh --keep-db  keep the database (create it only if missing) instead of resetting
#   scripts/dev/stack.sh --no-web   skip the web app
#   scripts/dev/stack.sh --smoke    start everything, run scripts/dev/stack_smoke.py, stop, exit with its status
#
# Root scripts: `pnpm stack` and `pnpm stack:smoke`. Ctrl-C stops every process this script started.
#
# Environment (all optional):
#   STACK_DB      database name (default smriti_stack; db.sh also makes STACK_DB_test)
#   API_PORT      API port (default 8000)        WEB_PORT   web app port (default 5173)
#   REDIS_DB      Redis database index (default 5; Redis is shared on port 56379)
#   AI_PROVIDER   fake (default) or agnes; agnes needs AGNES_AI_API_KEY and AI_TIER_*_MODEL
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STACK_DIR="$ROOT/.dev/stack"
CONTENT_OUT="$STACK_DIR/content"
LOGS="$STACK_DIR/logs"
STACK_DB="${STACK_DB:-smriti_stack}"
API_PORT="${API_PORT:-8000}"
WEB_PORT="${WEB_PORT:-5173}"
PGPORT="${PGPORT:-54322}"
REDIS_PORT="${REDIS_PORT:-56379}"
REDIS_DB="${REDIS_DB:-5}"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"

RESET=1
WEB=1
SMOKE=0
for arg in "$@"; do
  case "$arg" in
    --keep-db) RESET=0 ;;
    --no-web) WEB=0 ;;
    --smoke) SMOKE=1 ;;
    --) ;; # `pnpm stack -- --keep-db` passes the separator through
    -h | --help)
      sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "unknown option $arg (see --help)" >&2
      exit 2
      ;;
  esac
done

log() { printf '\033[1;36m[stack]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[stack]\033[0m %s\n' "$*" >&2; }

API_URL="http://127.0.0.1:$API_PORT"
WEB_URL="http://127.0.0.1:$WEB_PORT"
export APP_ENV=local
export DATABASE_URL="postgresql+asyncpg://postgres:postgres@127.0.0.1:$PGPORT/$STACK_DB"
export REDIS_URL="redis://127.0.0.1:$REDIS_PORT/$REDIS_DB"
export AI_PROVIDER="${AI_PROVIDER:-fake}"
# The API serves the published folder at /v1/content/files, the way the CDN serves R2.
export CONTENT_LOCAL_DIR="$CONTENT_OUT"
export CONTENT_MANIFEST_PATH='manifests/{exam}.{locale}.json'
export CONTENT_ROOT="$ROOT/content"
export CONTENT_PUBLISH_REPORT_DIR="$CONTENT_OUT"
# Jobs go through Redis to the arq worker, as in production.
export JOBS_MODE=arq
export API_PUBLIC_URL="$API_URL"
export WEB_APP_URL="$WEB_URL"

PIDS=()
STOPPING=0

stop_all() {
  [ "$STOPPING" = 1 ] && return
  STOPPING=1
  if [ "${#PIDS[@]}" -gt 0 ]; then
    log "stopping ${#PIDS[@]} processes"
    for pid in "${PIDS[@]}"; do
      # Each process runs in its own process group (setsid), so its children stop with it.
      kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    done
    for _ in $(seq 1 50); do
      local alive=0
      for pid in "${PIDS[@]}"; do
        kill -0 "$pid" 2>/dev/null && alive=1
      done
      [ "$alive" = 0 ] && break
      sleep 0.1
    done
    for pid in "${PIDS[@]}"; do
      kill -KILL -- "-$pid" 2>/dev/null || true
    done
  fi
}
trap 'stop_all' EXIT
trap 'stop_all; exit 130' INT TERM

# start NAME DIR COMMAND...: runs COMMAND in DIR in its own process group, output to logs/NAME.log.
start() {
  local name="$1" dir="$2"
  shift 2
  (cd "$dir" && exec setsid "$@") >"$LOGS/$name.log" 2>&1 &
  PIDS+=("$!")
  log "$name started (log: ${LOGS#"$ROOT"/}/$name.log)"
}

# wait_for NAME URL SECONDS: polls URL until it answers 2xx.
wait_for() {
  local name="$1" url="$2" seconds="$3"
  for _ in $(seq 1 $((seconds * 4))); do
    if curl -fsS -o /dev/null --max-time 2 "$url" 2>/dev/null; then
      return 0
    fi
    sleep 0.25
  done
  fail "$name did not answer at $url within ${seconds}s; last lines of its log:"
  tail -n 30 "$LOGS/$name.log" >&2 || true
  return 1
}

port_free() {
  ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

mkdir -p "$LOGS" "$CONTENT_OUT"
for port in "$API_PORT" $([ "$WEB" = 1 ] && echo "$WEB_PORT"); do
  if ! port_free "$port"; then
    fail "port $port is in use; set API_PORT or WEB_PORT"
    exit 1
  fi
done

# 1. Postgres and Redis, and the stack database (reset by default, so every run starts clean).
DB_CMD=up
[ "$RESET" = 1 ] && DB_CMD=reset
log "database $STACK_DB: db.sh $DB_CMD (log: ${LOGS#"$ROOT"/}/db.log)"
SMRITI_DB_NAME="$STACK_DB" bash "$ROOT/scripts/dev/db.sh" "$DB_CMD" >"$LOGS/db.log" 2>&1 || {
  fail "db.sh $DB_CMD failed:"
  tail -n 30 "$LOGS/db.log" >&2
  exit 1
}
grep -E 'migrations applied|already running|started on' "$LOGS/db.log" | sed 's/^/  /' || true

# 2. The real content publish (content/ → bundles, manifests, metadata.sql) into the stack folder,
#    then metadata.sql into the database and the card index, as the content publish job does.
log "publishing content/ to ${CONTENT_OUT#"$ROOT"/}"
pnpm --silent --filter @smriti/content-publish publish:local --out "$CONTENT_OUT" >"$LOGS/publish.log" 2>&1 || {
  fail "content publish failed:"
  tail -n 30 "$LOGS/publish.log" >&2
  exit 1
}
grep -m1 '^published' "$LOGS/publish.log" || true
PGPASSWORD=postgres "$PGBIN/psql" -h 127.0.0.1 -p "$PGPORT" -U postgres -d "$STACK_DB" \
  -v ON_ERROR_STOP=1 -q -o /dev/null -f "$CONTENT_OUT/metadata.sql"
log "metadata.sql applied to $STACK_DB"
(cd "$ROOT" && uv run --quiet --project apps/api python scripts/dev/card_index.py "$ROOT/content")

# 3. API, the arq default worker (crons live there) and the web app on the real API.
start api "$ROOT/apps/api" uv run --quiet uvicorn smriti_api.main:app --host 127.0.0.1 --port "$API_PORT"
start worker "$ROOT/apps/worker" uv run --quiet python -m smriti_worker default
if [ "$WEB" = 1 ]; then
  pnpm --silent --filter @smriti/tokens build >"$LOGS/web-prep.log" 2>&1
  pnpm --silent --filter @smriti/web assets >>"$LOGS/web-prep.log" 2>&1
  VITE_APP_ENV=local VITE_AUTH_MODE=dev VITE_APP_VARIANT=all VITE_FAKE_API= \
    VITE_API_BASE_URL="$API_URL" \
    start web "$ROOT/apps/web" pnpm run dev:api --host 127.0.0.1 --port "$WEB_PORT" --strictPort
fi

wait_for api "$API_URL/readyz" 60
if [ "$WEB" = 1 ]; then
  wait_for web "$WEB_URL/" 90
fi
sleep 1
for i in "${!PIDS[@]}"; do
  if ! kill -0 "${PIDS[$i]}" 2>/dev/null; then
    fail "a process exited early; see $LOGS"
    exit 1
  fi
done

log "ready"
log "  API      $API_URL   (docs: $API_URL/docs)"
[ "$WEB" = 1 ] && log "  Web      $WEB_URL   (the real API, dev sign-in)"
log "  Content  $API_URL/v1/content/files/manifests/"
log "  DB       $DATABASE_URL"
log "  Redis    $REDIS_URL   AI_PROVIDER=$AI_PROVIDER"

if [ "$SMOKE" = 1 ]; then
  log "running the smoke journey"
  status=0
  (cd "$ROOT" && STACK_API_URL="$API_URL" STACK_WEB_URL="$([ "$WEB" = 1 ] && echo "$WEB_URL")" \
    uv run --quiet --project apps/api python scripts/dev/stack_smoke.py) || status=$?
  if [ "$status" = 0 ]; then log "smoke passed"; else fail "smoke failed (exit $status)"; fi
  exit "$status"
fi

log "Ctrl-C to stop"
# Stay up until a process exits or Ctrl-C.
while true; do
  for pid in "${PIDS[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      fail "a process stopped; see $LOGS"
      exit 1
    fi
  done
  sleep 1
done
