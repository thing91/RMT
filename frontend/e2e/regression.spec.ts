import { expect, signIn, test } from './fixtures'

test.describe('signing in', () => {
  // Regression: the project list stayed empty after signing in until a reload.
  test('the project list shows private projects right after signing in', async ({ page, data }) => {
    await page.goto('/')
    await expect(page.getByText(data.projectName)).toHaveCount(0)
    await page.getByRole('button', { name: 'Zaloguj' }).first().click()
    await page.getByPlaceholder('Login').fill('admin')
    await page.getByPlaceholder('Hasło').fill('e2e')
    await page.getByRole('button', { name: 'Zaloguj' }).last().click()
    await expect(page.getByText(data.projectName)).toBeVisible()
  })

  test('the interface switches between Polish and English', async ({ page, data }) => {
    await signIn(page, data.token)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Projekty' })).toBeVisible()
    await page.getByRole('button', { name: 'Admin' }).click()
    await page.getByRole('button', { name: 'EN', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  })
})

test.describe('documents', () => {
  test('a project opens on "my work" and lists its documents', async ({ page, data }) => {
    await signIn(page, data.token)
    await page.goto(`/projects/${data.projectId}`)
    await expect(page.getByRole('heading', { name: data.projectName })).toBeVisible()
    await expect(page.getByText('Czeka na Ciebie')).toBeVisible()
    await page.getByRole('link', { name: 'System Requirements' }).first().click()
    await expect(page.getByText(`Battery autonomy ${data.suffix}`, { exact: true })).toBeVisible()
    await expect(page.locator('[data-item-row]', { hasText: 'Power' }).first()).toContainText('1')
  })

  test('search (Ctrl+K) finds a requirement and opens it with its details', async ({ page, data }) => {
    await signIn(page, data.token)
    await page.goto('/')
    await page.keyboard.press('Control+K')
    await page.keyboard.type(`Solar array output ${data.suffix}`)
    await expect(page.getByRole('button', { name: new RegExp(`Solar array output ${data.suffix}`) })).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(new RegExp(`/documents/${data.documentId}`))
    await expect(page.getByRole('tab', { name: 'Szczegóły' }).or(page.getByRole('button', { name: 'Szczegóły' }))).toBeVisible()
  })

  test('editing in place takes the lock, saves and shows up in the history', async ({ page, data, request }) => {
    await signIn(page, data.token)
    await page.goto(`/projects/${data.projectId}/documents/${data.documentId}`)
    await page.getByRole('button', { name: '✎ Edycja' }).click()
    const row = page.locator('[data-item-row]', { hasText: `Battery autonomy ${data.suffix}` })
    await row.getByText(`Battery autonomy ${data.suffix}`, { exact: true }).dblclick()
    const input = row.locator('input')
    await expect(input).toBeVisible()

    // While editing, the requirement is locked by us.
    const headers = { Authorization: `Bearer ${data.token}` }
    const during = await (await request.get(`/api/v1/items/${data.requirementIds[0]}`, { headers })).json()
    expect(during.lock?.user_name).toBe('Admin')

    await input.fill(`Battery autonomy ≥ 35 min ${data.suffix}`)
    await input.press('Enter')
    await expect(row.getByText(`Battery autonomy ≥ 35 min ${data.suffix}`, { exact: true })).toBeVisible()
    await expect
      .poll(async () => (await (await request.get(`/api/v1/items/${data.requirementIds[0]}`, { headers })).json()).lock)
      .toBeNull()

    await page.reload()
    await expect(page.getByText(`Battery autonomy ≥ 35 min ${data.suffix}`, { exact: true })).toBeVisible()
    await page.getByText(`Battery autonomy ≥ 35 min ${data.suffix}`, { exact: true }).click()
    await page.getByRole('button', { name: 'Aktywność' }).click()
    await expect(page.getByText(/Edycja\s*v2/)).toBeVisible()
  })

  test('readers without edit rights get the review view only', async ({ page, data, request }) => {
    const headers = { Authorization: `Bearer ${data.token}` }
    await request.patch(`/api/v1/projects/${data.projectId}`, { headers, data: { visibility: 'public' } })
    await page.goto(`/projects/${data.projectId}/documents/${data.documentId}`)
    await expect(page.getByText(`Battery autonomy ${data.suffix}`, { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '✎ Edycja' })).toHaveCount(0)
  })
})

test.describe('baselines', () => {
  test('a document baseline is a frozen, read-only copy that can be compared with now', async ({ page, data, request }) => {
    await signIn(page, data.token)
    await page.goto(`/projects/${data.projectId}/documents/${data.documentId}`)
    await page.getByRole('button', { name: 'Więcej' }).first().click()
    await page.getByRole('button', { name: 'Utwórz baseline…' }).click()
    await page.locator('#baseline-name').fill('SRR')
    await page.getByRole('button', { name: 'Utwórz baseline' }).click()
    await expect(page.getByText('Baseline „SRR”')).toBeVisible()
    await expect(page.getByText('tylko do odczytu')).toBeVisible()
    await expect(page.getByRole('button', { name: '✎ Edycja' })).toHaveCount(0)

    // Change the live document; the baseline keeps the old text.
    const headers = { Authorization: `Bearer ${data.token}` }
    const item = await request.get(`/api/v1/items/${data.requirementIds[1]}`, { headers })
    await request.patch(`/api/v1/items/${data.requirementIds[1]}`, {
      headers: { ...headers, 'If-Match': item.headers()['etag'] },
      data: { title: `Solar array output 200 W ${data.suffix}` },
    })
    await page.reload()
    await expect(page.getByText(`Solar array output ${data.suffix}`, { exact: true })).toBeVisible()
    await page.locator('#baseline-compare').check()
    await expect(page.getByText('zmienione od tego czasu')).toBeVisible()
    await expect(page.getByText(/zmienione lub wycofane: 1/)).toBeVisible()

    await page.getByRole('link', { name: 'Wróć do wersji bieżącej' }).click()
    await expect(page.getByText(`Solar array output 200 W ${data.suffix}`, { exact: true })).toBeVisible()
  })
})

test.describe('top bar and settings', () => {
  test('the glossary is one click away in the top bar', async ({ page, data }) => {
    await signIn(page, data.token)
    await page.goto('/')
    await page.getByRole('link', { name: 'Słownik pojęć' }).click()
    await expect(page).toHaveURL(/\/glossary$/)
    await expect(page.getByRole('heading', { name: 'Słownik pojęć' })).toBeVisible()
  })

  test('the API page documents the API and issues a working personal token', async ({ page, data, request }) => {
    await signIn(page, data.token)
    await page.goto('/admin/api')
    await expect(page.getByText('/api/v1').first()).toBeVisible()
    await expect(page.getByRole('link', { name: /Swagger/ })).toHaveAttribute('href', '/api/docs')
    await page.locator('#api-token-name').fill(`e2e ${data.suffix}`)
    await page.getByRole('button', { name: 'Utwórz token' }).click()
    const token = (await page.locator('pre').filter({ hasText: /^rmt_/ }).textContent())!.trim()
    const me = await request.get('/api/v1/auth/me', { headers: { Authorization: `Bearer ${token}` } })
    expect((await me.json()).username).toBe('admin')
    await page.getByRole('row', { name: new RegExp(`e2e ${data.suffix}`) }).getByRole('button', { name: 'Unieważnij' }).click()
    await expect(page.getByRole('row', { name: new RegExp(`e2e ${data.suffix}`) }).getByText('unieważniony')).toBeVisible()
    const after = await request.get('/api/v1/auth/me', { headers: { Authorization: `Bearer ${token}` } })
    expect(after.status()).toBe(401)
  })

  test('the API documentation is served', async ({ request }) => {
    expect((await request.get('/api/docs')).ok()).toBeTruthy()
    const spec = await (await request.get('/api/openapi.json')).json()
    expect(spec.components.securitySchemes.bearer).toBeTruthy()
  })

  test('an admin can download a full database export', async ({ page, data }) => {
    await signIn(page, data.token)
    await page.goto('/admin/database')
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Pobierz eksport' }).click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(/^rmt-.*\.zip$/)
  })
})
