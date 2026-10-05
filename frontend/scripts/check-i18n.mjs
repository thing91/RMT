// Fails when a string passed to t() has no Polish translation in
// src/i18n/pl.ts — so a new screen can't ship half in English.
//   npm run i18n:check
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
// Placeholders and technical tokens that stay as they are in every language.
const ALLOWED = new Set(['https://…', 'perm:suggestion.resolve', 'LEO, MEO, GEO'])

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

const unescape = (s, q) => s.replaceAll(`\\${q}`, q).replaceAll('\\\\', '\\')
const pl = readFileSync(join(SRC, 'i18n', 'pl.ts'), 'utf8')
const keys = new Set()
for (const m of pl.matchAll(/^\s*'((?:[^'\\]|\\.)*)':/gm)) keys.add(unescape(m[1], "'"))
for (const m of pl.matchAll(/^\s*"((?:[^"\\]|\\.)*)":/gm)) keys.add(unescape(m[1], '"'))

const missing = new Map()
for (const file of files(SRC)) {
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(/\b(?:t|tr|tx)\(\s*(['"])((?:(?!\1)[^\\]|\\.)*)\1/g)) {
    const key = unescape(m[2], m[1])
    if (!keys.has(key) && !ALLOWED.has(key)) {
      const where = missing.get(key) ?? []
      where.push(file.slice(SRC.length))
      missing.set(key, where)
    }
  }
}

if (missing.size > 0) {
  console.error(`${missing.size} UI string(s) without a Polish translation in src/i18n/pl.ts:`)
  for (const [key, where] of missing) console.error(`  ${JSON.stringify(key)}  ← ${[...new Set(where)].join(', ')}`)
  process.exit(1)
}
console.log(`All ${keys.size} translated strings OK.`)
