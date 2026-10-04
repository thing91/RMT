# All-in-one image: Postgres + the FastAPI backend + the built frontend,
# one process to run, one volume to back up. Simpler to operate than the
# docker-compose.yml setup (separate db/backend/web containers) at the cost
# of the usual downsides of bundling a database into an app container —
# fine for a review/test deployment; split back out via docker-compose.yml
# when this needs to scale or be backed up/upgraded independently.

FROM node:20-alpine AS frontend-build
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

FROM python:3.12-slim

# git: app/services/git_sync.py shells out to it (README §7).
# postgresql: the database, running inside this same container.
# gosu: safe drop-privilege to the `postgres` user from the entrypoint
# (the same tool the official postgres image uses, rather than su/sudo).
RUN apt-get update && apt-get install -y --no-install-recommends \
        git postgresql postgresql-contrib gosu \
    && rm -rf /var/lib/apt/lists/* \
    # Debian ships initdb/pg_ctl/psql under a version-numbered
    # /usr/lib/postgresql/<ver>/bin, not on PATH — symlink them in so the
    # entrypoint can call them by name regardless of which version apt
    # picked.
    && ln -s /usr/lib/postgresql/*/bin/* /usr/local/bin/

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .
COPY --from=frontend-build /frontend/dist /app/frontend_dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV FRONTEND_DIST=/app/frontend_dist \
    DATA_DIR=/data \
    PORT=8000

VOLUME ["/data"]
EXPOSE 8000

ENTRYPOINT ["docker-entrypoint.sh"]
