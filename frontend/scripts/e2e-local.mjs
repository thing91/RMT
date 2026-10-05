// Runs the Playwright regression suite locally against a throw-away copy of
// RMT: its own database schema ("e2e", recreated every run), the backend on
// :8002 serving a fresh production build. Your development data is never
// touched.
//   npm run test:e2e:local [-- <playwright args>]
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontend = join(dirname(fileURLToPath(import.meta.url)), '..')
const backend = join(frontend, '..', 'backend')
const python = [join(backend, '.venv', 'Scripts', 'python.exe'), join(backend, '.venv', 'bin', 'python')].find(existsSync) ?? 'python'
const PORT = process.env.E2E_PORT ?? '8002'
const SCHEMA = 'e2e'

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' && cmd === 'npx', ...opts })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

// Base URL from the backend's own settings, pointed at the e2e schema.
const base = spawnSync(python, ['-c', 'from app.config import settings; print(settings.database_url)'], {
  cwd: backend,
  encoding: 'utf8',
}).stdout.trim()
const databaseUrl = `${base}${base.includes('?') ? '&' : '?'}options=-csearch_path%3D${SCHEMA}`
const env = { ...process.env, DATABASE_URL: databaseUrl, GIT_SYNC_ENABLED: 'false', DEV_AUTH_FALLBACK: 'true' }

console.log(`▶ fresh "${SCHEMA}" schema`)
run(python, ['-c', `
from sqlalchemy import create_engine, text
from app.config import settings
e = create_engine(settings.database_url)
with e.begin() as c:
    c.execute(text('DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE'))
    c.execute(text('CREATE SCHEMA ${SCHEMA}'))
`], { cwd: backend })
run(python, ['-m', 'alembic', 'upgrade', 'head'], { cwd: backend, env })
run(python, ['-m', 'app.seed'], { cwd: backend, env })

console.log('▶ production build')
run('npx', ['vite', 'build', '--logLevel', 'warn'], { cwd: frontend })

console.log(`▶ backend on :${PORT}`)
const server = spawn(python, ['-m', 'uvicorn', 'app.main:app', '--port', PORT], {
  cwd: backend,
  env: { ...env, FRONTEND_DIST: join(frontend, 'dist') },
  stdio: 'ignore',
})
const baseUrl = `http://localhost:${PORT}`
let up = false
for (let i = 0; i < 60 && !up; i++) {
  try {
    up = (await fetch(`${baseUrl}/api/v1/health`)).ok
  } catch {
    await new Promise((r) => setTimeout(r, 1000))
  }
}
if (!up) {
  server.kill()
  console.error('Backend did not start.')
  process.exit(1)
}

console.log('▶ playwright')
const result = spawnSync('npx', ['playwright', 'test', ...process.argv.slice(2)], {
  cwd: frontend,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, BASE_URL: baseUrl },
})
server.kill()
process.exit(result.status ?? 1)
