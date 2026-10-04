#!/bin/sh
set -e

DATA_DIR=${DATA_DIR:-/data}
export PGDATA=$DATA_DIR/postgres
POSTGRES_USER=${POSTGRES_USER:-rmt}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-rmt}
POSTGRES_DB=${POSTGRES_DB:-rmt_kna}

mkdir -p "$PGDATA" "$DATA_DIR/git_sync_repos" "$DATA_DIR/mail_outbox" "$DATA_DIR/reference_files"
chown -R postgres:postgres "$DATA_DIR/postgres"

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "[entrypoint] First run — initializing Postgres in $PGDATA"
  gosu postgres initdb -D "$PGDATA" --auth=trust --auth-host=trust >/dev/null
  # trust auth is fine here: Postgres binds to localhost only and nothing
  # outside this container can reach port 5432 at all (not published).
  gosu postgres pg_ctl -D "$PGDATA" -l "$DATA_DIR/postgres.log" -w start
  gosu postgres psql -v ON_ERROR_STOP=1 -c "CREATE USER \"$POSTGRES_USER\" WITH PASSWORD '$POSTGRES_PASSWORD';"
  gosu postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$POSTGRES_DB\" OWNER \"$POSTGRES_USER\";"
  gosu postgres pg_ctl -D "$PGDATA" -m fast -w stop
fi

echo "[entrypoint] Starting Postgres..."
gosu postgres pg_ctl -D "$PGDATA" -l "$DATA_DIR/postgres.log" -w start

export DATABASE_URL=${DATABASE_URL:-postgresql+psycopg2://$POSTGRES_USER:$POSTGRES_PASSWORD@localhost:5432/$POSTGRES_DB}
export GIT_REPO_ROOT=${GIT_REPO_ROOT:-$DATA_DIR/git_sync_repos}
export MAIL_OUTBOX_DIR=${MAIL_OUTBOX_DIR:-$DATA_DIR/mail_outbox}
export REFERENCE_FILES_DIR=${REFERENCE_FILES_DIR:-$DATA_DIR/reference_files}

# A JWT_SECRET nobody set explicitly still needs to survive a container
# restart (otherwise every restart logs everyone out) — generate one once
# and persist it on the same data volume as everything else.
if [ -z "$JWT_SECRET" ]; then
  SECRET_FILE="$DATA_DIR/jwt_secret"
  if [ ! -f "$SECRET_FILE" ]; then
    python -c "import secrets; print(secrets.token_hex(32))" > "$SECRET_FILE"
    chmod 600 "$SECRET_FILE"
  fi
  export JWT_SECRET=$(cat "$SECRET_FILE")
fi

echo "[entrypoint] Running database migrations..."
alembic upgrade head

echo "[entrypoint] Starting the app on port ${PORT:-8000}..."
uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers &
APP_PID=$!

stop_all() {
  echo "[entrypoint] Shutting down..."
  kill -TERM "$APP_PID" 2>/dev/null || true
  wait "$APP_PID" 2>/dev/null || true
  gosu postgres pg_ctl -D "$PGDATA" -m fast stop
}
trap stop_all TERM INT

wait "$APP_PID"
