FROM python:3.12-slim

# git: app/services/git_sync.py shells out to the CLI for the per-project
# local sync (README §7) — not optional, the app breaks without it.
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# Applies any pending migrations before every start — safe to run on an
# already-current database (it's a no-op), and means a restart after a
# `git pull` picks up schema changes without a separate manual step.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers"]
