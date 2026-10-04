# Deploying RMT-KNA to a server

Two ways to run this, same app either way:

- **Option A — one container.** Postgres, the backend, and the built
  frontend all inside a single image, one `docker run`. Simplest to copy
  to a test server and just run — this is the one to reach for first.
- **Option B — docker compose.** Postgres, backend, and frontend as three
  separate containers. More moving parts, but each piece can be
  backed up/upgraded/scaled independently — reach for this once the
  single-container setup outgrows itself.

Both need Docker Engine on the target server (`docker version` should
work). Get the code onto that server first — `git clone`, or copy the
working tree over — everything below assumes you're in the repo root.

## Resource sizing

This is a lightweight stack (FastAPI + Postgres + a static React build) —
no need for anything elaborate. For an internal review with up to a few
dozen concurrent users, **2 vCPU, 4 GB RAM, 20–40 GB disk** is comfortable.
Disk grows mainly from `git_sync_repos/` (one local git repo per project,
one YAML file per item write) and any uploaded standard/reference PDFs —
both live on a volume, not baked into the image.

## Option A: one container

1. Build the image (this compiles the frontend and installs the backend in
   one multi-stage build — no Node/Python needed on the server itself,
   only Docker):

   ```bash
   docker build -t rmt-kna .
   ```

2. Run it. Everything that needs to persist — Postgres's data, the
   generated JWT secret, git sync history, uploaded reference files — lives
   under one mounted volume:

   ```bash
   docker volume create rmt-kna-data
   docker run -d --name rmt-kna \
     -p 8000:8000 \
     -v rmt-kna-data:/data \
     -e APP_BASE_URL=http://<server-hostname-or-ip>:8000 \
     rmt-kna
   ```

   First start takes a few extra seconds — it initializes Postgres, creates
   the `rmt`/`rmt_kna` role and database, generates and saves a random
   `JWT_SECRET` onto the volume (so restarts don't invalidate every
   session), then runs `alembic upgrade head` before serving. Watch it with
   `docker logs -f rmt-kna`.

3. Confirm it's up: `curl http://localhost:8000/api/v1/health`, then open
   `http://<server>:8000/` in a browser.

4. (Optional) Seed demo data for a first walkthrough:

   ```bash
   docker exec rmt-kna python -m app.seed
   ```

   Skip this for a deployment meant to hold real data from day one — it
   also provisions a demo `admin` user.

**Configuring it** — pass more `-e` flags on `docker run` (or put them in
an env file and use `--env-file`). The ones you'll actually want to change:

| Variable | Default | Purpose |
|---|---|---|
| `APP_BASE_URL` | `http://localhost` | Used to build links in notification emails — set to the real URL people will use. |
| `DEV_AUTH_FALLBACK` | `true` | Any username + non-empty password logs in. Leave `true` only on a server nobody untrusted can reach. |
| `LDAP_URL`, `LDAP_BASE_DN`, `LDAP_BIND_DN`, `LDAP_BIND_PASSWORD`, `LDAP_USER_SEARCH_FILTER` | unset | Real directory auth — see README "Logging in". Set these and `DEV_AUTH_FALLBACK=false` before anyone but you touches this server. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `MAIL_FROM` | unset | Blank `SMTP_HOST` writes emails to `/data/mail_outbox/*.html` instead of sending them — fine for a first review. |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | `rmt`/`rmt`/`rmt_kna` | Only matter on first run (they create the role/database) — changing them later does nothing without a manual `ALTER ROLE`. |

**Updating later:**
```bash
git pull
docker build -t rmt-kna .
docker stop rmt-kna && docker rm rmt-kna
docker run -d --name rmt-kna -p 8000:8000 -v rmt-kna-data:/data \
  -e APP_BASE_URL=http://<server-hostname-or-ip>:8000 \
  rmt-kna
```
The container re-runs `alembic upgrade head` on every start, so a schema
change since your last deploy is applied automatically — **read the
migration first** if this holds real data; autogenerate is a diff, not a
guarantee. The `rmt-kna-data` volume is untouched by the rebuild, so
Postgres data, the JWT secret, and everything else survive.

**Backup** — one volume holds everything (`rmt-kna-data`): Postgres's data
directory, `git_sync_repos/`, `reference_files/`, and the generated JWT
secret. `docker run --rm -v rmt-kna-data:/data -v $(pwd):/backup alpine
tar czf /backup/rmt-kna-data.tar.gz -C /data .` is enough for an
occasional snapshot; for the live Postgres data specifically, prefer a
proper `pg_dump` while the container's running:
```bash
docker exec rmt-kna pg_dump -U rmt rmt_kna > backup.sql
```

## Option B: docker compose (separate services)

1. From the repo root:

   ```bash
   cp .env.example .env
   ```

2. Edit `.env`:
   - `POSTGRES_PASSWORD` — a real password, not the placeholder.
   - `JWT_SECRET` — required, compose refuses to start without it:
     ```bash
     openssl rand -hex 32
     ```
   - `APP_BASE_URL` — the URL people will actually use (e.g.
     `http://rmt.internal.example.com` or `http://<server-ip>` if there's
     no DNS entry yet).
   - `DEV_AUTH_FALLBACK` — same rule as Option A.
   - `SMTP_*` — leave blank to keep writing notification emails to
     `mail_outbox/` inside the container instead of sending them.

3. Build and start everything:

   ```bash
   docker compose up -d --build
   ```

   The backend's container runs `alembic upgrade head` automatically before
   it starts serving.

4. Confirm it's up:

   ```bash
   curl http://localhost:${WEB_PORT:-80}/api/v1/health
   ```

   then open `http://<server>:${WEB_PORT:-80}/` in a browser.

5. (Optional) Seed demo data:

   ```bash
   docker compose exec backend python -m app.seed
   ```

**Updating later:**
```bash
git pull
docker compose up -d --build
```

**Backups** — three named volumes hold state, back up all three:
- `pgdata` — `docker compose exec db pg_dump -U rmt rmt_kna > backup.sql`.
- `git_sync_repos` — every project's local git history of item changes.
- `reference_files` — uploaded standard/reference-document PDFs.

(`mail_outbox` only matters if `SMTP_HOST` is unset — a dev convenience,
not something to back up once real email is configured.)

## Checklist before this is more than a review server

- [ ] **Real auth.** `DEV_AUTH_FALLBACK=false` plus a working `LDAP_*`
  block (see `.env.example`/the table above and README "Logging in") —
  right now, by default, *any* username and any non-empty password logs in
  as that user.
- [ ] **TLS.** Both options above serve plain HTTP. Put this behind
  whatever your company already uses for TLS termination (a reverse proxy,
  load balancer, or a sidecar like Caddy/Traefik) rather than exposing the
  container's port directly — sessions carry a JWT in the `Authorization`
  header, and LDAP credentials cross the wire at login, both need TLS in
  transit.
- [ ] **Real SMTP**, if you want review-workflow and mention notifications
  to actually reach people's inboxes.
- [ ] **A backup schedule** for the volume(s) above, not just a plan to add
  one later.
- [ ] Running as root inside the container (both options) is fine for a
  review box; if this becomes long-lived, drop privileges for the app
  process the way the bundled Postgres already does via `gosu`.
- [ ] Read `README.md`'s "Known simplifications" section — a few other
  gaps are called out there (no org-admin role, git sync is local-only,
  parameters have no unit conversion, …) that matter more once this holds
  real project data than they do for a review.
