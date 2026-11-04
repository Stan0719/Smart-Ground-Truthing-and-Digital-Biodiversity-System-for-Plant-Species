import { test, expect } from '@playwright/test'
import { createServer, request as proxyRequest } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, extname, sep } from 'node:path'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { createTestAuth } from '../../server/test-postgres.mjs'
import { createAuthServer } from '../../server/http.mjs'
import { createStaffInvitations } from '../../server/activation.mjs'
const require = createRequire(import.meta.url)
const { createPlantDatabase } = require('../../../plant-conservation-backend/test/postgres-fixture.cjs')
const { createPlantApp } = require('../../../plant-conservation-backend/server.js')
const sharp = require('../../../plant-conservation-backend/node_modules/sharp')
const root = resolve(import.meta.dirname, '../..'),
  dist = resolve(root, 'dist')
let folder, auth, pool, plantServer, site, authServer, authPort, plantPort, origin
const password = randomBytes(24).toString('hex')
const failures = new Map()
function monitor(page) {
  const errors = []
  failures.set(page, errors)
  page.on('pageerror', () => errors.push('Uncaught browser error'))
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:'))
      errors.push(message.text().replaceAll(password, '[REDACTED]').slice(0, 400))
  })
  page.on('response', (response) => {
    if (response.url().startsWith(origin) && response.status() >= 500)
      errors.push(`HTTP ${response.status()} from local app`)
  })
}
async function call(context, path, method = 'GET', data) {
  return context.request.fetch(origin + path, {
    method,
    data,
    timeout: 10000,
    headers: { Origin: origin },
  })
}
async function apiLogin(context, role) {
  const r = await call(context, '/api/auth/login', 'POST', {
    email: `${role}@example.invalid`,
    password,
  })
  expect(r.status()).toBe(200)
}
async function uiLogin(page, role) {
  await page.goto(origin)
  await page.getByRole('button', { name: 'Login', exact: true }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Email', { exact: true }).fill(`${role}@example.invalid`)
  await dialog.getByLabel('Password', { exact: true }).fill(password)
  await dialog.getByRole('button', { name: 'Login', exact: true }).click()
  if (role === 'admin') await expect(page).toHaveURL(origin + '/admin')
  if (role === 'officer') await expect(page).toHaveURL(origin + '/conservation/dashboard')
}

test.beforeAll(async () => {
  if (!existsSync(resolve(dist, 'index.html')))
    throw Error('Run npm run build before browser tests.')
  folder = mkdtempSync(resolve(tmpdir(), 'niah-browser-'))
  auth = await createTestAuth()
  await auth.db.prepare('UPDATE security_settings SET login_limit=100 WHERE id=1').run()
  for (const [name, role] of [
    ['admin', 'Administrator'],
    ['officer', 'Conservation Officer'],
    ['botanist', 'Botanist'],
  ])
    await auth.createUser({
      name,
      email: `${name}@example.invalid`,
      role,
      password,
      mustChangePassword: false,
    })
  await auth.createVisitor({ name: 'visitor', email: 'visitor@example.invalid', password })
  pool = await createPlantDatabase()
  site = createServer((req, res) => {
    if (req.url.startsWith('/api/')) {
      const plant = req.url.startsWith('/api/data/') || /^\/api\/(species|plants|observations|species-requests|tables|db-test)(?:[/?]|$)/.test(req.url)
      const upstream = proxyRequest(
        {
          host: '127.0.0.1',
          port: plant ? plantPort : authPort,
          path: plant ? req.url.replace('/api/data/', '/api/') : req.url,
          method: req.method,
          headers: req.headers,
        },
        (response) => {
          res.writeHead(response.statusCode, response.headers)
          response.pipe(res)
        },
      )
      upstream.on('error', () => {
        res.writeHead(502)
        res.end()
      })
      req.pipe(upstream)
      return
    }
    const path = resolve(dist, '.' + new URL(req.url, 'http://localhost').pathname)
    if (!path.startsWith(dist + sep) && path !== dist) {
      res.writeHead(403)
      res.end()
      return
    }
    const file = existsSync(path) && statSync(path).isFile() ? path : resolve(dist, 'index.html')
    const mime = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.woff2': 'font/woff2',
    }
    res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream')
    res.end(readFileSync(file))
  }).listen(0, '127.0.0.1')
  await once(site, 'listening')
  origin = `http://127.0.0.1:${site.address().port}`
  authServer = createAuthServer({auth, env:{APP_ORIGIN:origin,NODE_ENV:'test'}}).listen(0,'127.0.0.1')
  await once(authServer,'listening')
  authPort=authServer.address().port
  plantServer = createPlantApp({ auth, pool, origins: new Set([origin]) }).listen(0, '127.0.0.1')
  await once(plantServer, 'listening')
  plantPort = plantServer.address().port
})
test.afterAll(async () => {
  for (const server of [site, plantServer, authServer])
    if (server) {
      server.closeAllConnections()
      await new Promise((r) => server.close(r))
    }
  if (pool) await pool.end()
  if (auth) await auth.db.close()
  if (folder) rmSync(folder, { recursive: true, force: true })
})
// The homepage embeds YouTube. Its player probes compute-pressure inside its
// restricted iframe and can emit unrelated policy diagnostics. Stub only that
// external document; all website/auth/plant requests still use real services.
test.beforeEach(async ({ context }) => {
  await context.route('https://*.tile.openstreetmap.org/**', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=',
        'base64',
      ),
    }),
  )
  await context.route('https://www.youtube-nocookie.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>External video excluded from system checks</title>',
    }),
  )
})
test.afterEach(() => {
  const errors = [...failures.values()].flat()
  failures.clear()
  expect(errors).toEqual([])
})

test('guest homepage and Explore Plants render a real empty catalogue', async ({ page }) => {
  monitor(page)
  await page.goto(origin)
  await expect(page.getByText('No public plant species have been added yet.')).toBeVisible()
  await page.goto(origin + '/plants')
  await expect(page.getByRole('heading', { name: 'No species added yet' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})
test('Administrator login, reload, dashboard guards and logout work', async ({ page, context }) => {
  monitor(page)
  await uiLogin(page, 'admin')
  await expect(page).toHaveURL(origin + '/admin')
  await expect(
    page.getByRole('heading', { name: 'Administrator Dashboard', exact: true }),
  ).toBeVisible()
  await expect(
    page.locator('.summary-card').filter({ hasText: 'Total Users' }).locator('strong'),
  ).toHaveText('4')
  await expect(page.locator('.summary-card').filter({ hasText: 'Database' }).locator('strong')).toHaveText('postgresql')
  await expect(page.locator('.quick-actions button')).toHaveCount(4)
  await expect(page.getByText('uptimeSeconds', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Notifications', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Administrator notifications' })).toBeVisible()
  await page.getByRole('button', { name: 'Notifications', exact: true }).click()
  await page.screenshot({ path: test.info().outputPath('admin-dashboard.png'), fullPage: true })
  await page.screenshot({ path: test.info().outputPath('admin-dashboard-viewport.png'), fullPage: false })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Quick Actions' })).toBeVisible()
  expect((await call(context, '/api/data/devices')).status()).toBe(200)
  expect((await call(context, '/api/data/species')).status()).toBe(403)
  await page.goto(origin + '/conservation/dashboard')
  await expect(page).toHaveURL(origin + '/')
  await page.goto(origin + '/admin')
  await page.getByRole('button', { name: 'Logout', exact: true }).click()
  await expect(page).toHaveURL(origin + '/')
  expect((await call(context, '/api/auth/me')).status()).toBe(401)
})
test('Conservation Officer login, reload and dashboard guard work', async ({ page, context }) => {
  monitor(page)
  await uiLogin(page, 'officer')
  await expect(page).toHaveURL(origin + '/conservation/dashboard')
  await page.reload()
  expect((await call(context, '/api/data/reports')).status()).toBe(200)
  expect((await call(context, '/api/admin/users')).status()).toBe(403)
  await page.goto(origin + '/admin')
  await expect(page).toHaveURL(origin + '/')
  await page.goto(origin + '/conservation/dashboard')
  await page.getByRole('button', { name: 'Logout', exact: true }).click()
  await expect(page).toHaveURL(origin + '/')
  expect((await call(context, '/api/auth/me')).status()).toBe(401)
})
test('Botanist website login directs to mobile and blocks the account page', async ({ page, context }) => {
  monitor(page)
  await uiLogin(page, 'botanist')
  await expect(page.getByRole('dialog')).toContainText('This account is intended for the Niah mobile application.')
  expect((await call(context, '/api/auth/me')).status()).toBe(401)
  await apiLogin(context, 'botanist')
  await page.goto(origin + '/account')
  await expect(page).toHaveURL(origin + '/')
  expect((await call(context, '/api/auth/me')).status()).toBe(401)
})

for (const role of ['visitor'])
  test(`${role} has an authenticated account page without staff dashboard privileges`, async ({
    page,
    context,
  }) => {
    monitor(page)
    await uiLogin(page, role)
    await expect(page).toHaveURL(origin+'/account')
    await expect(page.getByLabel('Email',{exact:true})).toHaveValue(role+'@example.invalid')
    expect((await call(context,'/api/auth/me')).status()).toBe(200)
    await page.reload()
    await expect(page.getByLabel('Email',{exact:true})).toHaveValue(role+'@example.invalid')
    expect((await call(context, '/api/data/observations')).status()).toBe(
      role === 'botanist' ? 200 : 403,
    )
    expect((await call(context, '/api/data/reports')).status()).toBe(403)
    await page.goto(origin + '/admin')
    await expect(page).toHaveURL(origin + '/')
    await call(context, '/api/auth/logout', 'POST', {})
    expect((await call(context, '/api/auth/me')).status()).toBe(401)
  })
test('Officer species entry, Botanist submission, review and public image display work together', async ({
  page,
  browser,
  context,
}) => {
  monitor(page)
  await uiLogin(page, 'officer')
  await page.goto(origin + '/conservation/species')
  await page.getByRole('button', { name: 'Add Species', exact: true }).click()
  await page.getByLabel('Scientific name', { exact: true }).fill('Synthetic browser species')
  await page.getByLabel('Common name', { exact: true }).fill('Browser fixture')
  await page
    .getByLabel('Description', { exact: true })
    .fill('Synthetic fixture in a temporary database only.')
  await page.getByLabel('Conservation status (verified name)').fill('Synthetic test status')
  await page.getByLabel('Publication classification').selectOption('public')
  await page.getByRole('button', { name: 'Save official species', exact: true }).click()
  await expect(page.getByText('Official species saved.')).toBeVisible()
  const catalog = await (await call(context, '/api/data/species?scope=scientific')).json()
  const species = catalog.species[0]
  expect(species.conservation_status).toBe('Synthetic test status')
  const officialPng = await sharp({
    create: { width: 2, height: 2, channels: 3, background: '#00ff00' },
  })
    .png()
    .toBuffer()
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click()
  await page
    .getByLabel('Official photo or PDF')
    .setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: officialPng })
  await expect(page.getByText('Official attachment uploaded.')).toBeVisible()
  const bot = await browser.newContext(),
    guest = await browser.newContext()
  try {
    await apiLogin(bot, 'botanist')
    const body = {
      species_id: species.species_id,
      latitude: 1,
      longitude: 2,
      client_key: 'browser-only',
      content: {
        heightCm: 12,
        healthStatus: 'Healthy',
        lifeStage: 'Young',
        morphology: 'Synthetic fixture',
        latitude: 1,
        longitude: 2,
      },
    }
    const created = await call(bot, '/api/data/plants', 'POST', body)
    expect(created.status()).toBe(201)
    const observation = await created.json()
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#00ff00' } })
      .png()
      .toBuffer()
    const upload = await call(bot, '/api/data/assets', 'POST', {
      plant_id: observation.plant_id,
      observation_id: observation.id,
      client_key: 'browser-photo',
      content_type: 'image/png',
      base64: png.toString('base64'),
    })
    expect(upload.status()).toBe(201)
    const asset = await upload.json()
    expect((await (await call(guest, '/api/data/plants')).json()).plants).toEqual([])
    expect((await call(guest, `/api/data/assets/${asset.id}`)).status()).toBe(404)
    await call(bot, `/api/data/observations/${observation.id}/submit`, 'POST', {})
    await page.goto(origin + '/conservation/reviews')
    // Navigate away from the species editor; review actions belong to its dialog.
    await page.getByRole('button', { name: 'Review', exact: true }).first().click()
    await expect(page.getByRole('img',{name:'Observation photo',exact:true})).toBeVisible()
    await page.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(page.getByText('Decision saved.')).toBeVisible()
    expect((await (await call(guest, '/api/data/plants')).json()).plants).toHaveLength(1)
    expect((await call(guest, `/api/data/assets/${asset.id}`)).status()).toBe(200)
    const publicPage = await guest.newPage()
    monitor(publicPage)
    await publicPage.goto(origin + '/species')
    await expect(
      publicPage.getByRole('heading', { name: 'Browser fixture', exact: true }),
    ).toBeVisible()
    await expect
      .poll(() =>
        publicPage
          .getByRole('img', { name: 'Browser fixture', exact: true })
          .evaluate((image) => image.naturalWidth),
      )
      .toBeGreaterThan(0)
    await publicPage
      .getByRole('link', { name: /View Species/i })
      .first()
      .click()
    await expect(
      publicPage.getByRole('heading', { name: 'Browser fixture', exact: true }).first(),
    ).toBeVisible()
    await page.goto(origin + '/conservation/reports')
    for (const [label, prefix] of [
      ['Download biodiversity CSV', null],
      ['Download biodiversity PDF', '%PDF-'],
    ]) {
      const downloading = page.waitForEvent('download')
      await page.getByRole('button', { name: label, exact: true }).click()
      const download = await downloading
      const stream = await download.createReadStream()
      const chunks = []
      for await (const chunk of stream) chunks.push(chunk)
      const bytes = Buffer.concat(chunks)
      if (prefix) expect(bytes.subarray(0, 5).toString()).toBe(prefix)
      else expect(bytes.toString()).toContain('Synthetic browser species')
    }
  } finally {
    await bot.close()
    await guest.close()
  }
})

for (const [suffix, role] of [
  ['officer', 'Conservation Officer'],
  ['botanist', 'Botanist'],
]) {
  test(`new ${suffix} must use administrator-issued temporary password before protected access`, async ({
    page,
    context,
  }) => {
    monitor(page)
    let delivered
    const invitations = createStaffInvitations({
      auth,
      origin,
      deliver: async (value) => {
        delivered = value
      },
    })
    const email = `first-${suffix}@example.invalid`
    const created = await invitations.invite(
      { name: `First ${suffix}`, username: `first-${suffix}`, email, role },
      'isolated-admin',
      'browser-test',
    )
    expect(created.delivery).toBe('sent')
    await page.goto(origin)
    await page.getByRole('button', { name: 'Login', exact: true }).first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Email', { exact: true }).fill(email)
    await dialog.getByLabel('Password', { exact: true }).fill(delivered.temporaryPassword)
    await dialog.getByRole('button', { name: 'Login', exact: true }).click()
    await expect(page).toHaveURL(origin + '/change-password')
    expect((await call(context, '/api/data/species?scope=scientific')).status()).toBe(403)
    await page.goto(origin + '/conservation/dashboard')
    await expect(page).toHaveURL(origin + '/change-password')
    const replacement = randomBytes(24).toString('hex')
    await page.getByLabel('New Password', { exact: true }).fill(replacement)
    await page.getByLabel('Confirm Password', { exact: true }).fill(replacement)
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Change Password', exact: true }).click()
    await expect(page).toHaveURL(/passwordChanged=1/)
    expect((await call(context, '/api/auth/me')).status()).toBe(401)
    const old = await call(context, '/api/auth/login', 'POST', {
      email,
      password: delivered.temporaryPassword,
    })
    expect(old.status()).toBe(401)
    const login = await call(context, '/api/auth/login', 'POST', { email, password: replacement })
    expect(login.status()).toBe(200)
    expect((await login.json()).user.mustChangePassword).toBe(false)
    expect((await call(context, '/api/data/species?scope=scientific')).status()).toBe(200)
  })
}
test('old activation page cannot create or set a staff password', async ({ page, context }) => {
  monitor(page)
  await page.goto(origin + '/activate#token=synthetic-old-link')
  await expect(
    page.getByRole('heading', { name: 'Sign in with your temporary password' }),
  ).toBeVisible()
  await expect(page.locator('input[type=password]')).toHaveCount(0)
  expect(
    (
      await call(context, '/api/auth/activate', 'POST', {
        token: 'synthetic-old-link',
        password: 'bypass-attempt',
      })
    ).status(),
  ).toBe(410)
})

test('dashboard refresh uses actual sensor/alert data and does not fetch protected plant records', async ({
  page,
  context,
}) => {
  monitor(page)
  const stamp = new Date().toISOString()
  await pool.query(
    "INSERT INTO iot_device(id,name,key_hash,last_seen) VALUES('dashboard-device','Isolated Dashboard Sensor','test-hash',$1)",
    [stamp],
  )
  await pool.query('INSERT INTO sensor_reading(id,device_id,"values") VALUES($1,$2,$3)', [
    'dashboard-reading',
    'dashboard-device',
    { temperature: 31, humidity: 70 },
  ])
  await pool.query(
    "INSERT INTO threat_alert_history(id,device_id,reading_id,metric,value) VALUES('dashboard-alert','dashboard-device','dashboard-reading','temperature',31)",
  )
  try {
    await apiLogin(context, 'admin')
    const requested = []
    page.on('request', (r) => {
      if (r.url().startsWith(origin + '/api/')) requested.push(r.url())
    })
    await page.goto(origin + '/admin')
    await expect(
      page.locator('.summary-card').filter({ hasText: 'IoT Sensors' }).locator('strong'),
    ).toHaveText('1')
    await expect(page.getByText('Isolated Dashboard Sensor', { exact: true })).toBeVisible()
    await expect(page.getByText('dashboard-alert', { exact: true })).toBeVisible()
    expect(
      requested.some((url) => /\/api\/data\/(plants|species|observations|reports)/.test(url)),
    ).toBe(false)
    await page.getByRole('button', { name: 'Refresh dashboard', exact: true }).click()
    await expect(page.getByText('Isolated Dashboard Sensor', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'View All Alerts →', exact: true }).click()
    await expect(page).toHaveURL(origin + '/admin/alerts')
    // The profile-menu sign-out must also revoke the server cookie/session.
    await page.locator('.profile-button').click()
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click()
    await expect(page).toHaveURL(origin + '/')
    expect((await call(context, '/api/auth/me')).status()).toBe(401)
  } finally {
    await pool.query("DELETE FROM threat_alert_history WHERE id='dashboard-alert'")
    await pool.query("DELETE FROM sensor_reading WHERE id='dashboard-reading'")
    await pool.query("DELETE FROM iot_device WHERE id='dashboard-device'")
  }
})

test('dashboard distinguishes failed sensor loading from an empty sensor list', async ({
  page,
  context,
}) => {
  monitor(page)
  await context.route(origin + '/api/data/devices', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Isolated unavailable-source test' }),
    }),
  )
  await uiLogin(page, 'admin')
  await expect(page.getByRole('alert')).toContainText('Sensor status could not be loaded.')
  await expect(
    page.locator('.summary-card').filter({ hasText: 'IoT Sensors' }).locator('strong'),
  ).toHaveText('—')
  await expect(page.getByText('No threat alerts recorded.', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Administrator Dashboard', exact: true }),
  ).toBeVisible()
})

test('Add New User opens only in a focused dialog and never sends on open or cancel', async ({
  page,
  context,
}) => {
  monitor(page)
  await apiLogin(context, 'admin')
  await page.goto(origin + '/admin/users')
  let posts = 0
  await context.route(origin + '/api/admin/users', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    posts++
    const body = route.request().postDataJSON()
    expect(body.role).toBe('Botanist')
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ delivery: 'sent', user: { id: 'ui-only-mocked-account' } }),
    })
  })
  await expect(page.getByLabel('Full name', { exact: true })).toHaveCount(0)
  const add = page.getByRole('button', { name: /^＋\s*Add New User$/ })
  await add.click()
  let dialog = page.getByRole('dialog', { name: 'Add New User', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Full name', { exact: true })).toBeFocused()
  expect(posts).toBe(0)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(add).toBeFocused()
  expect(posts).toBe(0)
  await add.click()
  dialog = page.getByRole('dialog', { name: 'Add New User', exact: true })
  await dialog.getByLabel('Full name', { exact: true }).fill('UI only test')
  await dialog.getByLabel('Username', { exact: true }).fill('invalid username')
  await dialog.getByLabel('Email', { exact: true }).fill('ui-only@example.invalid')
  await dialog
    .getByRole('button', { name: 'Create account and email temporary password', exact: true })
    .click()
  expect(posts).toBe(0)
  expect(
    await dialog
      .getByLabel('Username', { exact: true })
      .evaluate((input) => input.validity.patternMismatch),
  ).toBe(true)
  await dialog.getByLabel('Username', { exact: true }).fill('ui-only-test')
  await dialog
    .getByRole('button', { name: 'Create account and email temporary password', exact: true })
    .click()
  await expect(dialog).toHaveCount(0)
  expect(posts).toBe(1)
  await expect(page.getByRole('status')).toContainText('Staff account created.')
  await page.setViewportSize({ width: 390, height: 844 })
  await add.click()
  dialog = page.getByRole('dialog', { name: 'Add New User', exact: true })
  const box = await dialog.boundingBox()
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.width).toBeLessThanOrEqual(390)
  await page.screenshot({ path: test.info().outputPath('add-user-mobile.png'), fullPage: false })
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(posts).toBe(1)
})

test('Role and Permission retains the original cards with live grants on desktop and phone', async ({ page, context }) => {
  monitor(page)
  await apiLogin(context, 'admin')
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(origin + '/admin/roles')
    await expect(page.getByRole('region', { name: 'Role summary' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'System roles' }).locator('article')).toHaveCount(4)
    const row = page.getByRole('row').filter({ hasText: 'plants.protected.read' })
    await expect(row.locator('td').nth(0)).toHaveText('—')
    await expect(row.locator('td').nth(1)).toHaveText('✓')
    await page.screenshot({ path: test.info().outputPath(`roles-${width}.png`), fullPage: true })
  }
})

test('Administrator dashboard retains its original sections on a phone', async ({ page, context }) => {
  monitor(page)
  await apiLogin(context, 'admin')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(origin + '/admin')
  await expect(page.locator('.summary-card')).toHaveCount(6)
  await expect(page.getByRole('heading', { name: 'Sensor Status Overview' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Recent Threat Alerts' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Quick Actions' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: test.info().outputPath('admin-dashboard-phone.png'), fullPage: false })
})

test('Administrator modules render correct headings, active menus and empty data on desktop and phone', async ({
  page,
  context,
}) => {
  monitor(page)
  await apiLogin(context, 'admin')
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 900 })
    for (const [path, title] of [
      ['roles', 'Role & Permission'],
      ['iot', 'IoT Monitoring'],
      ['sensors', 'Sensor Management'],
      ['alerts', 'Threat Alerts'],
      ['settings', 'Security Settings'],
      ['activity', 'System Activity'],
      ['profile', 'Profile Settings'],
    ]) {
      await page.goto(origin + '/admin/' + path)
      await expect(page.getByRole('heading', { name: title, exact: true }).first()).toBeVisible()
      await expect(page.getByRole('alert')).toHaveCount(0)
      if (path === 'roles') {
        await expect(page.getByText('plants.protected.read', { exact: true })).toBeVisible()
        const row = page.getByRole('row').filter({ hasText: 'plants.protected.read' })
        await expect(row).toContainText('✓')
        await expect(row.locator('td').nth(0)).toHaveText('—')
        await expect(row.locator('td').nth(1)).toHaveText('✓')
        await expect(row.locator('td').nth(2)).toHaveText('—')
      }
      if (path === 'sensors') {
        await expect(
          page.getByRole('button', { name: 'Register Sensor', exact: true }),
        ).toBeVisible()
        await expect(page.getByText('No sensors registered yet.', { exact: true })).toBeVisible()
      }
      if (path === 'alerts')
        await expect(page.getByText('No threat alerts recorded.', { exact: true })).toBeVisible()
      if (path === 'profile')
        await expect(page.getByLabel('Full Name', { exact: true })).toHaveValue('admin')
      if (width === 1366 && path === 'sensors')
        await page.screenshot({
          path: test.info().outputPath('sensors-desktop.png'),
          fullPage: false,
        })
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
      ).toBe(true)
    }
  }
})

test('sensor registration, threshold edit and status controls use real isolated APIs in dialogs', async ({
  page,
  context,
}) => {
  monitor(page)
  await apiLogin(context, 'admin')
  await page.goto(origin + '/admin/sensors')
  await expect(page.getByLabel('Device Name', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: /^＋\s*Register Sensor$/ }).click()
  let dialog = page.getByRole('dialog', { name: 'Register Sensor', exact: true })
  await dialog.getByLabel('Device Name', { exact: true }).fill('Isolated UI Sensor')
  await dialog.getByRole('button', { name: 'Register sensor', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'One-time device key' })).toBeVisible()
  await page.getByRole('button', { name: 'Dismiss key' }).click()
  const records = await (await call(context, '/api/data/devices')).json()
  const device = records.devices.find((row) => row.name === 'Isolated UI Sensor')
  expect(device).toBeTruthy()
  try {
    await page.getByRole('button', { name: 'Configure threshold', exact: true }).click()
    dialog = page.getByRole('dialog', { name: 'Configure Alert Threshold', exact: true })
    await dialog.getByLabel('Threshold', { exact: true }).fill('34.5')
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect(
      (await (await call(context, '/api/data/devices')).json()).devices.find(
        (row) => row.id === device.id,
      ).thresholds.temperature,
    ).toBe(34.5)
    await page.getByRole('button', { name: 'Edit sensor', exact: true }).click()
    dialog = page.getByRole('dialog', { name: 'Edit Sensor', exact: true })
    await dialog.getByLabel('Device status').selectOption('Inactive')
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect(
      (await (await call(context, '/api/data/devices')).json()).devices.find(
        (row) => row.id === device.id,
      ).status,
    ).toBe('Inactive')
  } finally {
    await pool.query('DELETE FROM iot_device WHERE id=$1', [device.id])
  }
})

test('Conservation Officer pages render safely on desktop and phone with modal species/review controls', async ({
  page,
  context,
}) => {
  monitor(page)
  await apiLogin(context, 'officer')
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 900 })
    for (const [path, title] of [
      ['dashboard', 'Conservation Dashboard'],
      ['species', 'Plant Species'],
      ['observations', 'Observations'],
      ['reviews', 'Review Submissions'],
      ['map', 'Biodiversity Map'],
      ['iot', 'IoT Monitoring'],
      ['alerts', 'Threat Alerts'],
      ['reports', 'Reports'],
      ['profile', 'Profile Settings'],
    ]) {
      await page.goto(origin + '/conservation/' + path)
      await expect(page.getByRole('heading', { name: title, exact: true }).first()).toBeVisible()
      await expect(page.getByRole('alert')).toHaveCount(0)
      if (path === 'species') {
        await expect(page.getByLabel('Scientific name', { exact: true })).toHaveCount(0)
        await page.getByRole('button', { name: 'Add Species', exact: true }).click()
        await expect(page.getByRole('dialog', { name: 'Add official species' })).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(page.getByRole('dialog')).toHaveCount(0)
      }
      if (path === 'reports')
        await expect(page.getByRole('button', { name: 'Download biodiversity CSV' })).toBeVisible()
      if (width === 1366 && path === 'species')
        await page.screenshot({
          path: test.info().outputPath('officer-species-desktop.png'),
          fullPage: false,
        })
      if (path === 'profile') {
        await expect(page.getByLabel('Full Name', { exact: true })).toHaveValue('officer')
        await expect(page.getByLabel('Full Name', { exact: true })).toHaveAttribute('readonly', '')
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
      ).toBe(true)
    }
  }
  await page.locator('.profile-button').click()
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click()
  await expect(page).toHaveURL(origin + '/')
  expect((await call(context, '/api/auth/me')).status()).toBe(401)
})

test('profile password form verifies current credentials and changes only the isolated account', async ({
  page,
  context,
}) => {
  monitor(page)
  await auth.createUser({
    name: 'Profile Test Officer',
    email: 'profile-officer@example.invalid',
    role: 'Conservation Officer',
    password,
    mustChangePassword: false,
  })
  await apiLogin(context, 'profile-officer')
  await page.goto(origin + '/conservation/profile')
  await expect(page.getByLabel('Full Name', { exact: true })).toHaveValue('Profile Test Officer')
  const replacement = randomBytes(24).toString('hex')
  await page.getByLabel('Current Password', { exact: true }).fill('incorrect-current-password')
  await page.getByLabel('New Password', { exact: true }).fill(replacement)
  await page.getByLabel('Confirm New Password', { exact: true }).fill(replacement)
  await page.getByRole('button', { name: 'Update Password', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  expect(
    (await auth.login('profile-officer@example.invalid', password, 'isolated-check')).token,
  ).toBeTruthy()
  await page.getByLabel('Current Password', { exact: true }).fill(password)
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Update Password', exact: true }).click()
  await expect(page).toHaveURL(/passwordChanged=1/)
  expect((await call(context, '/api/auth/me')).status()).toBe(401)
  expect(
    (
      await call(context, '/api/auth/login', 'POST', {
        email: 'profile-officer@example.invalid',
        password,
      })
    ).status(),
  ).toBe(401)
  expect(
    (
      await call(context, '/api/auth/login', 'POST', {
        email: 'profile-officer@example.invalid',
        password: replacement,
      })
    ).status(),
  ).toBe(200)
})

test('recovery restores original card and handles both steps without email delivery', async ({ page }) => {
  monitor(page)
  const recoveryId = 'a'.repeat(32)
  let confirmations = 0
  await page.route('**/api/auth/recovery/request', async route => {
    expect(route.request().postDataJSON()).toEqual({ email: 'recovery@example.invalid' })
    await route.fulfill({ status: 202, json: { recoveryId, message: 'If an eligible account exists, a recovery code will be sent. Delivery is not confirmed here.' } })
  })
  await page.route('**/api/auth/recovery/confirm', async route => {
    confirmations++
    expect(route.request().postDataJSON()).toEqual({ recoveryId, code: '123456', password: 'A secure recovery password!', confirmation: 'A secure recovery password!' })
    await route.fulfill(confirmations === 1 ? { status: 400, json: { error: 'Recovery code is invalid or expired.' } } : { status: 200, json: { ok: true } })
  })
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(origin + '/forgot-password')
    const card = page.locator('.recovery-card')
    await expect(card).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await expect(card).toHaveCSS('border-radius', '18px')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.getByLabel('Account email').fill('Recovery@Example.invalid')
  await page.screenshot({ path: 'test-results/recovery-email-mobile.png', fullPage: true })
  await page.getByRole('button', { name: 'Request recovery code', exact: true }).click()
  await expect(page.getByLabel('Recovery code', { exact: true })).toBeVisible()
  await page.getByLabel('Recovery code', { exact: true }).fill('123456')
  await page.getByLabel('New password', { exact: true }).fill('A secure recovery password!')
  await page.getByLabel('Confirm password', { exact: true }).fill('Different password here!')
  await page.getByRole('button', { name: 'Reset password', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Passwords do not match.')
  expect(confirmations).toBe(0)
  await page.getByLabel('Confirm password', { exact: true }).fill('A secure recovery password!')
  await page.getByRole('button', { name: 'Reset password', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Recovery code is invalid or expired.')
  await page.screenshot({ path: 'test-results/recovery-code-mobile.png', fullPage: true })
  await page.getByRole('button', { name: 'Reset password', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Password updated. Return to sign in.')
  await expect(page.getByLabel('New password', { exact: true })).toHaveCount(0)
  await page.getByRole('link', { name: 'Return to sign in' }).click()
  await expect(page).toHaveURL(origin + '/')
})

test('recovery request errors and restart retain styled email form', async ({ page }) => {
  monitor(page)
  let requests = 0
  await page.route('**/api/auth/recovery/request', async route => {
    requests++
    await route.fulfill(requests === 1 ? { status: 429, json: { error: 'Too many requests. Please try again later.' } } : { status: 202, json: { recoveryId: 'b'.repeat(32), message: 'Check your email if eligible.' } })
  })
  await page.goto(origin + '/forgot-password')
  await page.getByLabel('Account email').fill('recovery@example.invalid')
  await page.getByRole('button', { name: 'Request recovery code', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Too many requests')
  await page.getByRole('button', { name: 'Request recovery code', exact: true }).click()
  await page.getByRole('button', { name: 'Request a new code' }).click()
  await expect(page.getByLabel('Account email')).toBeVisible()
  await expect(page.getByLabel('Recovery code', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('homepage does not request forbidden plant data for staff awaiting password change', async ({ page }) => {
  monitor(page)
  let plantRequests=0
  await page.route('**/api/auth/me',route=>route.fulfill({status:200,json:{user:{id:'temporary-staff',name:'Temporary staff',email:'staff@example.invalid',role:'Botanist',status:'Active',mustChangePassword:true}}}))
  await page.route('**/api/data/**',route=>{plantRequests++;return route.fulfill({status:403,json:{error:'Access denied.'}})})
  await page.goto(origin+'/')
  await expect(page.getByRole('heading',{name:/Discover the/i})).toBeVisible()
  await expect.poll(()=>page.locator('.app-content > [role="alert"]').count()).toBe(0)
  expect(plantRequests).toBe(0)
})

test('homepage discards stale plant denial when admin session recovers', async ({ page }) => {
 monitor(page)
 let checks=0
 await page.route('**/api/auth/me',route=>{
  checks++
  return route.fulfill(checks===1?{status:401,json:{error:'Please sign in again.'}}:{status:200,json:{user:{id:'admin-fixture',name:'Admin',email:'admin@example.invalid',role:'Administrator',status:'Active',mustChangePassword:false}}})
 })
 await page.route('**/api/data/**',route=>route.fulfill({status:403,json:{error:'Access denied.'}}))
 await page.goto(origin+'/')
 await expect.poll(()=>checks).toBeGreaterThan(1)
 await expect(page.locator('.app-content > [role="alert"]')).toHaveCount(0)
})

test('removed Botanist website redirects to public homepage', async ({page})=>{
 monitor(page)
 await page.goto(origin+'/botanist')
 await expect(page).toHaveURL(origin+'/')
 await expect(page.getByRole('heading',{name:'Botanist Workspace',exact:true})).toHaveCount(0)
})

// Full non-IoT route and API matrices against isolated PostgreSQL services.
const adminPaths=['/admin','/admin/users','/admin/profile','/admin/roles','/admin/activity','/admin/settings'];
const officerPaths=['/conservation/dashboard','/conservation/profile','/conservation/species','/conservation/observations','/conservation/reviews','/conservation/map','/conservation/reports'];
for(const role of ['admin','officer','botanist','guest']){
 test('RBAC route matrix '+role,async({page,context})=>{
  if(role!=='guest')await apiLogin(context,role);
  for(const path of [...adminPaths,...officerPaths]){
   await page.goto(origin+path);
   const allowed=role==='admin'?adminPaths.includes(path):role==='officer'?officerPaths.includes(path):false;
   await expect(page).toHaveURL(origin+(allowed?path:'/'));
  }
 });
 test('RBAC API matrix '+role,async({context})=>{
  if(role!=='guest')await apiLogin(context,role);
  for(const [path,allowed] of [
   ['/api/admin/users',['admin']],['/api/admin/permissions',['admin']],['/api/admin/audit',['admin']],
   ['/api/data/species',['officer','botanist','guest']],['/api/data/observations',['officer','botanist']],
   ['/api/data/reports',['officer']],['/api/data/audit',['admin']]
  ]){
   const response=await call(context,path);
   expect(response.status(),role+' '+path).toBe(allowed.includes(role)?200:role==='guest'?401:403);
  }
 });
}
for(const [role,paths] of [['admin',adminPaths],['officer',officerPaths]])for(const path of paths){
 test('PostgreSQL page connection '+path,async({page,context})=>{
  await apiLogin(context,role);
  const errors=[],pending=new Set(),requested=[];
  page.on('request',r=>{if(r.url().startsWith(origin+'/api/')&&!r.url().startsWith(origin+'/api/iot/')){pending.add(r);requested.push(new URL(r.url()).pathname)}});
  page.on('requestfinished',r=>pending.delete(r));page.on('requestfailed',r=>{pending.delete(r);if(r.url().startsWith(origin+'/api/'))errors.push('Failed '+new URL(r.url()).pathname)});
  page.on('response',r=>{pending.delete(r.request());if(r.url().startsWith(origin+'/api/')&&!r.url().startsWith(origin+'/api/iot/')&&r.status()>=400)errors.push(r.status()+' '+new URL(r.url()).pathname)});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+path);await expect(page).toHaveURL(origin+path);
  await expect.poll(()=>pending.size,{timeout:10000}).toBe(0);
  const expected={'/admin/users':'/api/admin/users','/admin/roles':'/api/admin/permissions','/admin/activity':'/api/admin/audit','/conservation/species':'/api/data/species','/conservation/reports':'/api/data/reports'}[path];
  if(expected)expect(requested,'Page must load its data from the authenticated API').toContain(expected);
  if(path.endsWith('/profile'))await expect(page.getByLabel('Full Name',{exact:true})).toHaveValue(role);
  expect(errors,'Page requests must reach permitted existing endpoints').toEqual([]);
 });
}
