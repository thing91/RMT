import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test'

/** A fresh private project with one document: a section and two
 * requirements, created through the API as `admin` (dev sign-in accepts
 * any password). */
export interface Seeded {
  token: string
  orgId: string
  projectId: string
  projectName: string
  documentId: string
  requirementIds: string[]
  requirementKeys: string[]
  suffix: string
}

async function json<T>(r: Awaited<ReturnType<APIRequestContext['get']>>): Promise<T> {
  if (!r.ok()) throw new Error(`${r.url()} → ${r.status()} ${await r.text()}`)
  return (await r.json()) as T
}

export async function seed(request: APIRequestContext): Promise<Seeded> {
  const suffix = Math.random().toString(36).slice(2, 7)
  const { access_token: token } = await json<{ access_token: string }>(
    await request.post('/api/v1/auth/login', { data: { username: 'admin', password: 'e2e' } }),
  )
  const headers = { Authorization: `Bearer ${token}` }
  const [org] = await json<{ id: string }[]>(await request.get('/api/v1/organizations', { headers }))
  const types = await json<{ id: string; key: string; behavior: string }[]>(
    await request.get(`/api/v1/organizations/${org.id}/item-types`, { headers }),
  )
  const section = types.find((t) => t.behavior === 'structural')!
  const requirement = types.find((t) => t.key === 'requirement') ?? types.find((t) => t.behavior === 'content')!
  const projectName = `E2E ${suffix}`
  const project = await json<{ id: string }>(
    await request.post(`/api/v1/organizations/${org.id}/projects`, {
      headers,
      data: { name: projectName, visibility: 'private' },
    }),
  )
  const doc = await json<{ id: string }>(
    await request.post(`/api/v1/projects/${project.id}/documents`, { headers, data: { name: 'System Requirements' } }),
  )
  const sec = await json<{ id: string }>(
    await request.post(`/api/v1/documents/${doc.id}/items`, {
      headers,
      data: { title: 'Power', item_type_id: section.id },
    }),
  )
  const reqs = []
  for (const title of [`Battery autonomy ${suffix}`, `Solar array output ${suffix}`]) {
    reqs.push(
      await json<{ id: string; key: string }>(
        await request.post(`/api/v1/documents/${doc.id}/items`, {
          headers,
          data: { title, item_type_id: requirement.id, parent_id: sec.id, description_md: `${title} — description.` },
        }),
      ),
    )
  }
  return {
    token,
    orgId: org.id,
    projectId: project.id,
    projectName,
    documentId: doc.id,
    requirementIds: reqs.map((r) => r.id),
    requirementKeys: reqs.map((r) => r.key),
    suffix,
  }
}

/** Opens the app already signed in as admin, in Polish. */
export async function signIn(page: Page, token: string, lang: 'pl' | 'en' = 'pl') {
  await page.addInitScript(
    ([t, l]) => {
      localStorage.setItem('rmt_token', t)
      localStorage.setItem('rmt_lang', l)
    },
    [token, lang],
  )
}

export const test = base.extend<{ data: Seeded }>({
  data: async ({ request }, provide) => {
    await provide(await seed(request))
  },
})

export { expect }
