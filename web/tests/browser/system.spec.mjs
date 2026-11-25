import { test, expect } from '@playwright/test'
import { createServer, request as proxyRequest } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, extname, sep, relative as relativePath, isAbsolute } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { createTestAuth } from '../../server/test-postgres.mjs'
import { createAuthServer } from '../../server/http.mjs'
import { createStaffInvitations } from '../../server/activation.mjs'
const require = createRequire(import.meta.url)
const { createPlantDatabase } = require('../../../plant-conservation-backend/test/postgres-fixture.cjs')
const { createPlantApp } = require('../../../plant-conservation-backend/server.js')
const sharp = require('../../../plant-conservation-backend/node_modules/sharp')
const root = resolve(import.meta.dirname, '../..'),
  repositoryRoot = resolve(root, '..'),
  dist = resolve(process.env.NIAH_BROWSER_DIST || resolve(root, 'dist'))
let folder, auth, pool, plantServer, site, authServer, authPort, plantPort, origin
let responsiveFixtureSchemaReady = false
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
      errors.push(`HTTP ${response.status()} from ${new URL(response.url()).pathname}`)
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
async function mobileLogin(context, role) {
  const r = await context.request.fetch(origin + '/api/mobile/password', {
    method: 'POST', data: { email: `${role}@example.invalid`, password }, timeout: 10000,
  })
  expect(r.status()).toBe(200)
  return (await r.json()).token
}
async function nativeCall(context, token, path, method = 'GET', data) {
  return context.request.fetch(origin + path, {
    method, data, timeout: 10000, headers: { Authorization: `Bearer ${token}` },
  })
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
  if (process.env.NIAH_BROWSER_DIST) {
    const inDirectory = (parent, child) => {
      const relative = relativePath(resolve(parent), resolve(child))
      return relative === '' || (relative !== '..' && !relative.startsWith(`..${sep}`) && !isAbsolute(relative))
    }
    if (!inDirectory(tmpdir(), dist) || inDirectory(repositoryRoot, dist))
      throw Error('NIAH_BROWSER_DIST must be outside the repository and inside the system temporary directory.')
  }
  if (!existsSync(resolve(dist, 'index.html')))
    throw Error('Build the website into NIAH_BROWSER_DIST before browser tests.')
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
  for (const server of [site, authServer, plantServer])
    expect(server.address().address).toBe('127.0.0.1')
  expect(new URL(origin).hostname).toBe('127.0.0.1')
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
  await prepareResponsiveFixtureSchema()
  await uiLogin(page, 'officer')
  await page.goto(origin + '/conservation/species')
  await page.getByRole('button', { name: /Create Species/ }).click()
  await page.getByLabel(/Scientific Name/).fill('Synthetic browser species')
  await page.getByLabel(/Common Name/).fill('Browser fixture')
  await page.getByLabel(/Description/).fill('Synthetic fixture in a temporary database only.')
  await page.getByRole('radio', { name: /Public/ }).check()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Species created and verified from persisted backend data.')).toBeVisible()
  const catalog = await (await call(context, '/api/data/species?scope=scientific')).json()
  const species = catalog.species.find((entry) => entry.scientific_name === 'Synthetic browser species')
  expect(species).toBeDefined()
  expect(species.conservation_status).toBeNull()
  const bot = await browser.newContext(),
    guest = await browser.newContext()
  try {
    const qrId = (await pool.query(
      "INSERT INTO plant_app.qr_code(qr_code,status) VALUES($1,'generated') RETURNING qr_id",
      [`browser-only-${randomUUID()}`],
    )).rows[0].qr_id
    const botanistToken = await mobileLogin(bot, 'botanist')
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#00ff00' } }).png().toBuffer()
    const body = {
      species_id: species.species_id,
      scientific_name: 'Synthetic browser plant',
      qr_id: qrId,
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
      photos: Array.from({ length: 3 }, () => ({ content_type: 'image/png', base64: png.toString('base64') })),
    }
    const created = await nativeCall(bot, botanistToken, '/api/data/plant-submissions', 'POST', body)
    expect(created.status()).toBe(201)
    const observation = await created.json()
    expect(observation.status).toBe('Pending Review')
    const assetId = (await pool.query('SELECT id FROM plant_asset WHERE plant_id=$1 AND observation_id=$2 ORDER BY created_at,id LIMIT 1', [observation.plant_id, observation.id])).rows[0].id
    expect((await (await call(guest, '/api/data/plants')).json()).plants).toEqual([])
    expect((await call(guest, `/api/data/assets/${assetId}`)).status()).toBe(404)
    const reviewQueue = await call(context, '/api/data/observations?limit=100')
    expect(reviewQueue.status()).toBe(200)
    expect((await reviewQueue.json()).observations.some((row) => row.id === observation.id)).toBe(true)
    const detailResponse = await call(context, `/api/data/observations/${observation.id}`)
    expect(detailResponse.status()).toBe(200)
    const detail = await detailResponse.json()
    expect(detail.observation.assets).toHaveLength(3)
    expect((await call(context, `/api/data/assets/${detail.observation.assets[0].id}`)).status()).toBe(200)
    await page.goto(origin + '/conservation/reviews')
    // Navigate away from the species editor; review actions belong to its dialog.
    await page.getByRole('button', { name: 'Review', exact: true }).first().click()
    await expect(page.locator('.submitted-image-preview img').first()).toBeVisible()
    await page.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect.poll(async () => (await (await call(context, `/api/data/observations/${observation.id}`)).json()).observation.status).toBe('Approved')
    expect((await (await call(guest, '/api/data/plants')).json()).plants).toHaveLength(1)
    expect((await call(guest, `/api/data/assets/${assetId}`)).status()).toBe(200)
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
      ['Export CSV', null],
      ['Export PDF', '%PDF-'],
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
    await expect(page).toHaveURL(origin + '/admin/iot')
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
  // The modal test does not exercise dashboard data; keep unrelated shell
  // widgets independent from the isolated Plant API fixture schema.
  await context.route(/\/api\/data\/plants(?:\?.*)?$/, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ plants: [], species: [], page: { has_more: false, next_cursor: null } }),
  }))
  await context.route(/\/api\/data\/staff-notifications(?:\/unread-count)?(?:\?.*)?$/, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ notifications: [], unread_count: 0 }),
  }))
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

test('Administrator dashboard charts and section order remain responsive', async ({ page, context }) => {
  monitor(page)
  await apiLogin(context, 'admin')
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (['127.0.0.1', 'localhost'].includes(url.hostname) || ['data:', 'blob:'].includes(url.protocol)) return route.continue()
    return route.abort()
  })
  // The dashboard charts do not depend on inbox delivery. Keep this browser
  // scenario independent of the notification tables in the PGlite fixture.
  await page.route(/\/api\/data\/staff-notifications(?:\/.*)?(?:\?.*)?$/, route => {
    const path = new URL(route.request().url()).pathname
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(path.endsWith('/unread-count')
        ? { unread_count: 0 }
        : { notifications: [], unread_count: 0, read_through: '2026-11-25T00:00:00.000Z' }),
    })
  })
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(origin + '/admin')
    await expect(page.locator('.summary-card')).toHaveCount(6)
    await expect(page.getByRole('heading', { name: 'User Summary' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Sensor Status Overview' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Recent Threat Alerts' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Recent Sensor Activity' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Recent System Activity' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Quick Actions' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'System Status' })).toHaveCount(0)
    await expect(page.locator('.user-donut')).toBeVisible()
    await expect(page.locator('.user-legend li')).toHaveCount(4)
    await expect(page.locator('.sensor-bar-row')).toHaveCount(2)
    await expect(page.locator('.connectivity-note')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Manage Users/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /View IoT Monitoring/ })).toBeVisible()
    const userBox = await page.locator('.user-summary').boundingBox()
    const sensorBox = await page.locator('.sensor-overview').boundingBox()
    if (width > 920) expect(sensorBox.x).toBeGreaterThan(userBox.x + userBox.width / 2)
    else expect(sensorBox.y).toBeGreaterThan(userBox.y + userBox.height - 1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await page.screenshot({ path: test.info().outputPath(`admin-dashboard-${width}.png`), fullPage: true })
  }
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
        await row.scrollIntoViewIfNeeded()
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
        await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible()
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

test('recovery shares the login modal and handles both steps without email delivery', async ({ page }) => {
  monitor(page)
  const recoveryId = 'a'.repeat(32)
  let confirmations = 0
  await page.route('**/api/auth/recovery/request', async route => {
    expect(route.request().postDataJSON()).toEqual({ email: 'recovery@example.invalid' })
    await route.fulfill({ status: 202, json: { recoveryId, message: 'If an eligible account exists, a recovery code will be sent. Delivery is not confirmed here.' } })
  })
  await page.route('**/api/auth/recovery/confirm', async route => {
    confirmations++
    expect(route.request().postDataJSON()).toEqual({ recoveryId, code: '123456', password: 'A secure recovery password!' })
    await route.fulfill(confirmations === 1 ? { status: 400, json: { error: 'Recovery code is invalid or expired.' } } : { status: 200, json: { ok: true } })
  })
  for (const width of [1366, 768, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(origin + '/species')
    if (width <= 900) await page.locator('.menu-button').click()
    await page.getByRole('button', { name: 'Login', exact: true }).click()
    const card = page.getByRole('dialog')
    await card.getByRole('button', { name: 'Forgot password?' }).click()
    await expect(card).toHaveAccessibleName('Forgot Password?')
    await expect(page).toHaveURL(origin + '/species')
    await expect(page.locator('.modal-backdrop')).toHaveCSS('backdrop-filter', 'blur(7px)')
    await expect(card).toHaveCSS('border-radius', '22px')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.getByLabel('Account email').fill('invalid')
  await page.getByRole('button', { name: 'Request recovery code', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('Enter a valid email.')
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
  await page.getByRole('button', { name: 'Return to sign in' }).click()
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Welcome Back')
  await expect(page).toHaveURL(origin + '/species')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
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
  await expect(page.getByRole('alert')).toContainText('Too many recovery requests')
  await page.getByRole('button', { name: 'Request recovery code', exact: true }).click()
  await page.getByRole('button', { name: 'Request a new code' }).click()
  await expect(page.getByLabel('Account email')).toBeVisible()
  await expect(page.getByLabel('Recovery code', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(origin + '/')
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
  if(role==='admin'||role==='officer')await apiLogin(context,role);
  for(const path of [...adminPaths,...officerPaths]){
   await page.goto(origin+path);
   const allowed=role==='admin'?adminPaths.includes(path):role==='officer'?officerPaths.includes(path):false;
   await expect(page).toHaveURL(origin+(allowed?path:'/'));
  }
 });
 test('RBAC API matrix '+role,async({context})=>{
  let botanistToken
  if(role==='admin'||role==='officer')await apiLogin(context,role)
  else if(role==='botanist')botanistToken=await mobileLogin(context,role)
  for(const [path,allowed] of [
   ['/api/admin/users',['admin']],['/api/admin/permissions',['admin']],['/api/admin/audit',['admin']],
   ['/api/data/species',['admin','officer','botanist','guest']],['/api/data/observations',['officer','botanist']],
   ['/api/data/reports',['officer']],['/api/data/audit',['admin']]
  ]){
   const response=botanistToken?await nativeCall(context,botanistToken,path):await call(context,path);
   const expected = role === 'botanist' && path.startsWith('/api/admin/') ? 401 : allowed.includes(role) ? 200 : role === 'guest' ? 401 : 403;
   expect(response.status(),role+' '+path).toBe(expected);
  }
 });
}

async function seedResponsivePlants() {
  const suffix = randomBytes(5).toString('hex')
  const firstSpecies = (await pool.query(
    'INSERT INTO species(scientific_name,common_name) VALUES($1,$2) RETURNING species_id',
    [`Species scientific name for responsive test ${suffix} with a long descriptive phrase`, `Species common name for responsive test ${suffix}`],
  )).rows[0].species_id
  const secondSpecies = (await pool.query(
    'INSERT INTO species(scientific_name,common_name) VALUES($1,$2) RETURNING species_id',
    [`Second species scientific name ${suffix}`, `Second species common name ${suffix}`],
  )).rows[0].species_id
  const approved = []
  for (let index = 0; index < 28; index++) {
    const speciesId = index < 26 ? firstSpecies : secondSpecies
    const plantName = `Plant-level scientific name ${suffix} specimen ${String(index + 1).padStart(2, '0')} with a long botanical description`
    const row = (await pool.query(
      `INSERT INTO plant_record(species_id,scientific_name,registered_subject,rbac_status,qr_token)
       VALUES($1,$2,'staff:responsive-fixture','Approved',$3) RETURNING plant_id`,
      [speciesId, plantName, `responsive-${suffix}-${index}`],
    )).rows[0]
    approved.push({ id: String(row.plant_id), speciesId: String(speciesId), plantName })
  }
  const pending = (await pool.query(
    `INSERT INTO plant_record(species_id,scientific_name,registered_subject,rbac_status,qr_token)
     VALUES($1,$2,'staff:responsive-fixture','Pending Review',$3) RETURNING plant_id`,
    [firstSpecies, `Unapproved responsive fixture ${suffix}`, `responsive-${suffix}-pending`],
  )).rows[0]
  return {
    suffix,
    firstSpecies: String(firstSpecies),
    secondSpecies: String(secondSpecies),
    approved,
    pendingId: String(pending.plant_id),
  }
}

async function prepareResponsiveFixtureSchema() {
  if (responsiveFixtureSchemaReady) return
  for (const name of [
    '004-species-requests.sql',
    '006-atomic-plant-submissions.sql',
    '008-record-change-submissions.sql',
    '009-record-version-history.sql',
    '013-staff-notification-foundation.sql',
    '016-species-request-content-revision.sql',
    '017-species-review-cycle.sql',
    '032-translation-storage.sql',
  ]) {
    const path = resolve(repositoryRoot, 'plant-conservation-backend', 'migrations', name)
    await pool.query(readFileSync(path, 'utf8'))
  }
  // This read-only queue projection selects QR metadata. Match the isolated
  // observation-queue fixture without changing any persistent database.
  await pool.query(`CREATE TABLE IF NOT EXISTS plant_app.qr_code(
    qr_id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    plant_id INTEGER UNIQUE REFERENCES plant_app.plant_record(plant_id) ON DELETE SET NULL,
    qr_code TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'generated',
    generated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    assigned_at TIMESTAMPTZ,
    activated_at TIMESTAMPTZ,
    retired_at TIMESTAMPTZ
  )`)
  responsiveFixtureSchemaReady = true
}

async function seedResponsiveReviewSubmission() {
  const suffix = randomBytes(5).toString('hex')
  const speciesName = `Review species scientific name ${suffix} with deliberately long text for narrow mobile cards`
  const commonName = `Review species common name ${suffix} with a long description`
  const plantName = `Review Plant-level scientific name ${suffix}`
  const speciesId = (await pool.query(
    'INSERT INTO species(scientific_name,common_name) VALUES($1,$2) RETURNING species_id',
    [speciesName, commonName],
  )).rows[0].species_id
  const plantId = (await pool.query(
    `INSERT INTO plant_record(species_id,scientific_name,registered_subject,rbac_status,qr_token)
     VALUES($1,$2,'staff:responsive-fixture','Approved',$3) RETURNING plant_id`,
    [speciesId, plantName, `review-responsive-${suffix}`],
  )).rows[0].plant_id
  const observationId = randomUUID()
  const content = {
    heightCm: 125,
    healthStatus: 'Healthy',
    lifeStage: 'Mature',
    morphology: `Long review field ${suffix}: ${'leaf and stem detail '.repeat(9)}`,
    notes: `Long review notes ${suffix}: ${'synthetic fixture text '.repeat(9)}`,
    latitude: 1,
    longitude: 2,
    taxonomy: { family: 'Synthetic family', genus: 'Synthetic genus' },
  }
  await pool.query(
    `INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key,origin_type)
     VALUES($1,$2,'staff:responsive-fixture','Pending Review',$3::jsonb,$4,'initial_registration')`,
    [observationId, plantId, JSON.stringify(content), `review-responsive-${suffix}`],
  )
  await pool.query(
    `INSERT INTO plant_submission_receipt(owner_subject,client_key,payload_hash,result)
     VALUES('staff:responsive-fixture',$1,$2,$3::jsonb)`,
    [`review-responsive-${suffix}`, 'a'.repeat(64), JSON.stringify({
      id: observationId,
      plant_id: String(plantId),
      species_id: String(speciesId),
      species_request_id: null,
      status: 'Pending Review',
      qr_token: `review-responsive-${suffix}`,
    })],
  )
  return { suffix, observationId, plantId: `PL${String(plantId).padStart(3, '0')}`, plantName, speciesName, commonName }
}

async function seedAdminAlertFixture() {
  const suffix = randomUUID().replaceAll('-', '')
  const deviceId = `browser-device-${suffix}`
  const alertId = `browser-alert-${suffix}`
  const readingId = `browser-reading-${suffix}`
  await pool.query(
    `INSERT INTO iot_device(id,name,device_type,key_hash,status)
     VALUES($1,'Synthetic Admin Alert Sensor','Sensor','test-only-key-hash','Active')`,
    [deviceId],
  )
  await pool.query(
    `INSERT INTO sensor_reading(id,device_id,"values",created_at)
     VALUES($1,$2,'{"temperature":31}'::jsonb,'2026-11-22T08:00:00Z')`,
    [readingId, deviceId],
  )
  const sensorEvidence = JSON.stringify({
    version: 1, device_id: deviceId, plant_id: null, metric: 'temperature', value: 31,
    limits: { min: 26, max: 30 }, direction: 'high',
    values: { temperature: 31, humidity: 70, movement: 1, rainfall: 4049, soilMoisture: 4095 },
    captured_at: '2026-11-22T08:00:00Z', received_at: '2026-11-22T08:00:01Z',
  })
  await pool.query(
    `INSERT INTO threat_alert_history(id,device_id,reading_id,metric,value,status,created_at,detected_at,sensor_evidence)
     VALUES($1,$2,$3,'temperature',31,'New','2026-11-22T08:01:00Z','2026-11-22T08:00:00Z',$4::jsonb)`,
    [alertId, deviceId, readingId, sensorEvidence],
  )
  return { deviceId, alertId, readingId }
}

async function seedAdminNotificationFixture() {
  await prepareResponsiveFixtureSchema()
  const admin = await auth.byEmail('admin@example.invalid')
  const eventId = randomUUID()
  const notificationId = randomUUID()
  const accountName = `Synthetic Notification Officer ${randomUUID().slice(0, 8)}`
  await pool.query(
    `INSERT INTO staff_notification_event(id,source_key,event_type,audience_role,resource_kind,metadata,delivery_state,attempts,delivered_at)
     VALUES($1,$2,'account_administration','Administrator','system',$3::jsonb,'delivered',1,CURRENT_TIMESTAMP)`,
    [eventId, `browser-admin-notification:${eventId}`, JSON.stringify({ action: 'staff_created', account_name: accountName, role: 'Conservation Officer' })],
  )
  await pool.query(
    `INSERT INTO staff_notification(id,event_id,recipient_subject,intended_role)
     VALUES($1,$2,$3,'Administrator')`,
    [notificationId, eventId, `staff:${admin.id}`],
  )
  return { notificationId, accountName }
}

async function guardResponsiveNetwork(page) {
  await page.route('**/*', (route) => {
    const requested = new URL(route.request().url())
    if (requested.origin === origin || requested.protocol === 'data:' || requested.protocol === 'blob:')
      return route.continue()
    return route.abort()
  })
}

async function chooseLocale(page, index) {
  await page.locator('.language-trigger').click()
  const options = page.locator('.language-menu').getByRole('option')
  await expect(options).toHaveCount(3)
  await options.nth(index).click()
  await expect(page.locator('.language-trigger')).toHaveAttribute('aria-expanded', 'false')
}

async function expectNoHorizontalOverflow(page, soft = false) {
  const widths = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }))
  const check = soft ? expect.soft : expect
  check(widths.document, 'Document width must not overflow viewport').toBeLessThanOrEqual(widths.viewport + 1)
  check(widths.body, 'Body width must not overflow viewport').toBeLessThanOrEqual(widths.viewport + 1)
}

test.describe('Officer responsive browser checks', () => {
  test.setTimeout(180000)

  test('Officer responsive Plants Registry: widths, languages, filtering, pagination and read-only modal focus', async ({ page, context }) => {
    monitor(page)
    await guardResponsiveNetwork(page)
    await apiLogin(context, 'officer')
    await prepareResponsiveFixtureSchema()
    const fixture = await seedResponsivePlants()
    const topPlant = fixture.approved.at(-1)
    expect(topPlant).toBeTruthy()
    const registryResponse = await call(context, '/api/data/officer/plants')
    const registryBody = await registryResponse.text()
    expect(registryResponse.status(), registryBody).toBe(200)
    const registry = JSON.parse(registryBody)
    expect(registry.plants.every((plant) => plant.status === 'Approved')).toBe(true)
    expect(registry.plants.some((plant) => plant.id === fixture.pendingId)).toBe(false)
    expect(registry.plants.map((plant) => plant.id), JSON.stringify(registry.plants.slice(0, 2))).toContain(topPlant.id)

    const widths = [320, 375, 430, 720, 768, 1366]
    const locales = [
      { index: 0, name: 'en' },
      { index: 1, name: 'ms' },
      { index: 2, name: 'zh' },
    ]
    for (const locale of locales) {
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 })
        await page.goto(origin + '/conservation/plants')
        await chooseLocale(page, locale.index)
        await expect.soft(page.locator('.page-intro h2'), `${locale.name} ${width}px page heading`).toBeVisible()
        const rows = page.locator('.registry-table tbody tr')
        await expect.soft(rows, `${locale.name} ${width}px approved page size`).toHaveCount(25)
        const row = rows.filter({ hasText: `PL${String(topPlant.id).padStart(3, '0')}` })
        await expect.soft(row, `${locale.name} ${width}px Plant row`).toBeVisible()
        await expect.soft(row.locator('.plant-identity'), `${locale.name} ${width}px Plant-level name`).toContainText(fixture.suffix)
        await expect.soft(row.locator('td').nth(1), `${locale.name} ${width}px Species name`).toContainText(fixture.suffix)
        await expect.soft(row.locator('.plant-identity'), `${locale.name} ${width}px names remain distinct`).not.toContainText(`Second species scientific name ${fixture.suffix}`)

        const layout = await page.locator('.plants-registry').evaluate((container) => ({
          width: container.getBoundingClientRect().width,
          table: getComputedStyle(container.querySelector('.registry-table')).display,
          row: getComputedStyle(container.querySelector('.registry-table tbody tr')).display,
        }))
        const cards = layout.width <= 900
        expect.soft(layout.table, `${locale.name} ${width}px Registry table/card layout`).toBe(cards ? 'block' : 'table')
        expect.soft(layout.row, `${locale.name} ${width}px Registry row layout`).toBe(cards ? 'grid' : 'table-row')
        const responsiveBounds = await row.evaluate((element) => {
          const rect = element.getBoundingClientRect()
          const registry = element.closest('.plants-registry')?.getBoundingClientRect()
          const actions = element.querySelector('.registry-actions')
          const actionRect = actions?.getBoundingClientRect()
          const text = [...element.querySelectorAll('.plant-name-inline, .species-name, td:nth-child(2) .cell-value small')]
            .map((node) => {
              const bounds = node.getBoundingClientRect()
              const style = getComputedStyle(node)
              return {
                label: node.className || node.tagName,
                whiteSpace: style.whiteSpace,
                clientWidth: node.clientWidth,
                scrollWidth: node.scrollWidth,
                right: bounds.right,
              }
            })
          const buttons = [...element.querySelectorAll('.registry-actions button')].map((button) => {
            const bounds = button.getBoundingClientRect()
            return { left: bounds.left, right: bounds.right, visible: bounds.width > 0 && bounds.height > 0 }
          })
          return {
            left: rect.left,
            right: rect.right,
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            registryRight: registry?.right ?? 0,
            actions: actionRect ? { left: actionRect.left, right: actionRect.right, clientWidth: actions.clientWidth, scrollWidth: actions.scrollWidth } : null,
            text,
            buttons,
            viewport: window.innerWidth,
          }
        })
        expect.soft(responsiveBounds.right, `${locale.name} ${width}px Plant card/row stays inside registry`).toBeLessThanOrEqual(responsiveBounds.registryRight + 1)
        expect.soft(responsiveBounds.right, `${locale.name} ${width}px Plant card/row stays inside viewport`).toBeLessThanOrEqual(responsiveBounds.viewport + 1)
        expect.soft(responsiveBounds.scrollWidth, `${locale.name} ${width}px Plant card/row has no horizontal content overflow`).toBeLessThanOrEqual(responsiveBounds.clientWidth + 1)
        expect.soft(responsiveBounds.text.every((item) => item.whiteSpace !== 'nowrap'), `${locale.name} ${width}px long Plant/Species names are allowed to wrap`).toBe(true)
        expect.soft(responsiveBounds.text.every((item) => item.scrollWidth <= item.clientWidth + 1 && item.right <= responsiveBounds.right + 1), `${locale.name} ${width}px Plant/Species names are not clipped`).toBe(true)
        expect.soft(responsiveBounds.actions?.scrollWidth ?? 0, `${locale.name} ${width}px action group has no fixed-width overflow`).toBeLessThanOrEqual((responsiveBounds.actions?.clientWidth ?? 0) + 1)
        expect.soft(responsiveBounds.actions?.right ?? 0, `${locale.name} ${width}px action group stays inside card`).toBeLessThanOrEqual(responsiveBounds.right + 1)
        expect.soft(responsiveBounds.buttons.length, `${locale.name} ${width}px View/Edit/Delete controls exist`).toBe(3)
        expect.soft(responsiveBounds.buttons.every((button) => button.visible && button.left >= responsiveBounds.left - 1 && button.right <= Math.min(responsiveBounds.right, responsiveBounds.viewport) + 1), `${locale.name} ${width}px View/Edit/Delete controls fit inside visible card`).toBe(true)
        await expect.soft(page.locator('.registry-filters input')).toBeVisible()
        await expect.soft(page.locator('.registry-filters select')).toBeVisible()
        const filterBounds = await page.locator('.registry-filters .field').evaluateAll((fields) =>
          fields.map((field) => {
            const rect = field.getBoundingClientRect()
            return rect.left >= 0 && rect.right <= window.innerWidth + 1
          }),
        )
        expect.soft(filterBounds.every(Boolean), `${locale.name} ${width}px filters fit`).toBe(true)
        const rowActions = row.locator('.registry-actions button')
        await expect.soft(rowActions, `${locale.name} ${width}px View/Edit/Delete`).toHaveCount(3)
        for (const button of await rowActions.all())
          await expect.soft(button).toBeVisible()
        await expect.soft(page.locator('.registry-table')).not.toContainText('Map')
        await expect.soft(page.locator('.registry-table')).not.toContainText('QR-')
        await page.screenshot({
          path: test.info().outputPath(`plants-${width}-${locale.name}.png`),
          fullPage: false,
        })
        await expectNoHorizontalOverflow(page, true)
      }
    }

    await page.setViewportSize({ width: 375, height: 900 })
    await page.goto(origin + '/conservation/plants')
    await chooseLocale(page, 0)
    const search = page.locator('.registry-filters input')
    const plantIdQuery = `PL${String(topPlant.id).padStart(3, '0')}`
    const idSearchResponse = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return url.pathname === '/api/data/officer/plants' && url.searchParams.get('q') === plantIdQuery
    })
    await search.fill(plantIdQuery)
    const idSearch = await idSearchResponse
    expect(idSearch.status(), await idSearch.text()).toBe(200)
    await expect(page.locator('.registry-table tbody tr')).toHaveCount(1)
    await expect(page.locator('.registry-table tbody tr').first()).toContainText(topPlant.plantName)
    const plantNameQuery = `specimen ${String(topPlant.id).padStart(2, '0')}`
    const nameSearchResponse = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return url.pathname === '/api/data/officer/plants' && url.searchParams.get('q') === plantNameQuery
    })
    await search.fill(plantNameQuery)
    const nameSearch = await nameSearchResponse
    const nameSearchBody = await nameSearch.text()
    expect(nameSearch.status(), nameSearchBody).toBe(200)
    expect(JSON.parse(nameSearchBody).plants).toHaveLength(1)
    await expect(page.locator('.registry-table tbody tr')).toHaveCount(1)
    await search.fill('')
    await page.locator('.registry-filters select').selectOption(fixture.secondSpecies)
    await expect(page.locator('.registry-table tbody tr')).toHaveCount(2)
    await page.locator('.registry-filters select').selectOption('')
    const registryRows = page.locator('.registry-table tbody tr')
    await expect(registryRows).toHaveCount(25)
    const pagination = page.locator('.registry-pagination button')
    await expect(pagination.last()).toBeEnabled()
    await pagination.last().click()
    await expect(registryRows).toHaveCount(3)
    await expect(pagination.first()).toBeEnabled()
    await pagination.first().click()
    await expect(registryRows).toHaveCount(25)

    const viewButton = page.locator('.registry-table tbody tr').first().locator('.registry-actions button').first()
    await viewButton.focus()
    await page.keyboard.press('Tab')
    await expect(page.locator('.registry-actions button').nth(1)).toBeFocused()
    expect(await page.locator('.registry-actions button').nth(1).evaluate((element) => element.matches(':focus-visible'))).toBe(true)
    const selectedRow = page.locator('.registry-table tbody tr').first()
    const selectedPlantId = (await selectedRow.locator('.plant-identity strong').innerText()).trim()
    const selectedPlantRecordId = selectedPlantId.replace(/^PL0*/, '') || '0'
    const selectedPlantName = (await selectedRow.locator('.plant-identity em').innerText()).trim()
    await viewButton.click()
    const dialog = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: 'Plant Information', exact: true }),
    })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(selectedPlantRecordId)
    await expect(dialog).toContainText(selectedPlantName)
    for (let index = 0; index < 3; index++) {
      await page.keyboard.press('Tab')
      await expect(dialog.locator(':focus')).toHaveCount(1)
    }
    await dialog.locator('.close-button').click()
    await expect(dialog).toHaveCount(0)
    await expect(viewButton).toBeFocused()
  })

  test('Officer responsive Review Submissions: widths, languages, field labels, wrapping and read-only keyboard actions', async ({ page, context }) => {
    monitor(page)
    await guardResponsiveNetwork(page)
    await apiLogin(context, 'officer')
    await prepareResponsiveFixtureSchema()
    const fixture = await seedResponsiveReviewSubmission()
    const observationsResponse = await call(context, '/api/data/observations?limit=100')
    const observationsBody = await observationsResponse.text()
    expect(observationsResponse.status(), observationsBody).toBe(200)
    const queuedObservation = JSON.parse(observationsBody).observations.find((row) => row.id === fixture.observationId)
    expect(queuedObservation, JSON.stringify(queuedObservation)).toMatchObject({
      id: fixture.observationId,
      status: 'Pending Review',
      revision: 1,
      origin_type: 'initial_registration',
      content: expect.any(Object),
    })
    for (const path of ['/api/data/record-changes?limit=100', '/api/species-requests']) {
      const response = await call(context, path)
      expect(response.status(), `${path}: ${await response.text()}`).toBe(200)
    }
    const widths = [320, 375, 430, 720, 768, 1366]
    const locales = [
      { index: 0, name: 'en' },
      { index: 1, name: 'ms' },
      { index: 2, name: 'zh' },
    ]
    for (const locale of locales) {
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 })
        await page.goto(origin + '/conservation/reviews')
        await chooseLocale(page, locale.index)
        await expect.soft(page.locator('.page-header h1, .section-header h1, h1').first(), `${locale.name} ${width}px page heading`).toBeVisible()
        const row = page.locator('.reviews-table tbody tr').filter({ hasText: fixture.suffix })
        await expect.soft(row, `${locale.name} ${width}px submission row`).toBeVisible()
        await expect.soft(row.locator('.status-cell .badge')).toBeVisible()
        await expect.soft(row.locator('.status-cell .badge')).toHaveClass(/pending-review/)
        await expect.soft(row).toContainText(fixture.suffix)
        await expect.soft(row).toContainText(fixture.plantName.slice(-10))
        await expect.soft(row).toContainText(fixture.plantId)
        await expect.soft(row.locator('.submission-type-cell .species-request-badge')).toBeVisible()
        await expect.soft(row.locator('.actions-cell .action-button')).toBeVisible()

        const layout = await page.locator('.reviews-scroll').evaluate((container) => ({
          width: container.getBoundingClientRect().width,
          table: getComputedStyle(container.querySelector('.reviews-table')).display,
          row: getComputedStyle(container.querySelector('.reviews-table tbody tr')).display,
        }))
        const cards = layout.width <= 767
        expect.soft(layout.table, `${locale.name} ${width}px table/card layout`).toBe(cards ? 'block' : 'table')
        expect.soft(layout.row, `${locale.name} ${width}px row layout`).toBe(cards ? 'grid' : 'table-row')
        if (cards) {
          const mobileLabels = row.locator('.review-cell-label')
          await expect.soft(mobileLabels.first()).toHaveCount(1)
          const labelCount = await mobileLabels.count()
          expect.soft(labelCount, `${locale.name} ${width}px mobile field labels`).toBeGreaterThanOrEqual(7)
          for (let index = 1; index < labelCount; index++) {
            const colon = await mobileLabels.nth(index).evaluate((element) => getComputedStyle(element, '::after').content)
            expect.soft(colon, `${locale.name} ${width}px label colon ${index}`).toContain(':')
          }
        } else {
          await expect.soft(page.getByRole('columnheader').first()).toBeVisible()
        }
        const overflow = await row.evaluate((element) => ({
          client: element.clientWidth,
          scroll: element.scrollWidth,
          right: element.getBoundingClientRect().right,
          containerRight: element.closest('.reviews-scroll')?.getBoundingClientRect().right ?? 0,
        }))
        if (cards) {
          expect.soft(overflow.scroll, `${locale.name} ${width}px card content fits`).toBeLessThanOrEqual(overflow.client + 1)
          expect.soft(overflow.right, `${locale.name} ${width}px card stays inside its container`).toBeLessThanOrEqual(overflow.containerRight + 1)
        }
        await row.scrollIntoViewIfNeeded()
        await page.screenshot({
          path: test.info().outputPath(`reviews-${width}-${locale.name}.png`),
          fullPage: false,
        })
        await expectNoHorizontalOverflow(page, true)
      }
    }

    await page.setViewportSize({ width: 375, height: 900 })
    await page.goto(origin + '/conservation/reviews')
    await chooseLocale(page, 0)
    const search = page.locator('.reviews-filters .search-field input')
    await expect(search).toBeVisible()
    await search.focus()
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.activeElement?.matches(':focus-visible'))).toBe(true)
    const row = page.locator('.reviews-table tbody tr').filter({ hasText: fixture.suffix })
    const action = row.locator('.actions-cell .action-button')
    await expect(action).toBeVisible()
    await action.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog').first()
    await expect(dialog).toBeVisible()
    for (let index = 0; index < 3; index++) {
      await page.keyboard.press('Tab')
      await expect(dialog.locator(':focus')).toHaveCount(1)
    }
    await dialog.locator('.close-button').click()
    await expect(dialog).toHaveCount(0)
    await expect(action).toBeFocused()
  })
})
test('Admin Recent Alerts opens the selected read-only detail and preserves Device View', async ({ page }) => {
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.addInitScript(() => {
    window.__niahUnhandledRejections = []
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason
      window.__niahUnhandledRejections.push(reason instanceof Error ? reason.message : String(reason))
    })
  })
  await guardResponsiveNetwork(page)
  const fixture = await seedAdminAlertFixture()
  await uiLogin(page, 'admin')
  await page.goto(origin + '/admin/iot')
  await expect(page.getByRole('heading', { level: 1, name: 'IoT Monitoring', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Latest Available Readings' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Latest Alerts' })).toBeVisible()
  await expect(page.locator('.admin-alert-table')).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('admin-iot-rendered.png'), fullPage: true })
  expect(pageErrors, 'no uncaught page errors during initial route rendering').toEqual([])
  expect(await page.evaluate(() => window.__niahUnhandledRejections), 'no unhandled rejections during initial route rendering').toEqual([])

  let detailCalls = 0
  let releaseFirstFailure
  const firstFailureGate = new Promise((resolve) => { releaseFirstFailure = resolve })
  await page.route(`${origin}/api/data/alerts/${fixture.alertId}`, async (route) => {
    detailCalls += 1
    if (detailCalls === 1) {
      await firstFailureGate
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Synthetic detail request failure.' }),
      })
      return
    }
    await route.continue()
  })

  const alertView = page.locator('.admin-alert-table tbody tr')
    .filter({ hasText: fixture.alertId })
    .getByRole('button', { name: 'View', exact: true })
  await expect(alertView).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await alertView.click()
  const alertDialog = page.getByRole('dialog', { name: 'Alert Details' })
  await expect(alertDialog.getByRole('status')).toContainText('Loading alert details')
  releaseFirstFailure()
  await expect(alertDialog.getByRole('alert')).toBeVisible()
  await expect(alertDialog.getByRole('button', { name: 'Retry' })).toBeVisible()
  await alertDialog.getByRole('button', { name: 'Retry' }).click()
  await expect(alertDialog.locator('.live-alert-identifier code').first()).toHaveAttribute('title', fixture.alertId)
  await expect(alertDialog.getByText('Synthetic Admin Alert Sensor')).toBeVisible()
  await expect(alertDialog.getByText(fixture.readingId, { exact: true })).toBeVisible()
  const alertTypeValue = await alertDialog.locator('dt').filter({ hasText: 'Alert Type' })
    .evaluate((element) => element.nextElementSibling?.textContent?.trim())
  expect(alertTypeValue).toBe('Temperature')
  const recordedMetric = await alertDialog.locator('dt').filter({ hasText: 'Metric' })
    .evaluate((element) => element.nextElementSibling?.textContent?.trim())
  const recordedValue = await alertDialog.locator('dt').filter({ hasText: 'Recorded Value' })
    .evaluate((element) => element.nextElementSibling?.textContent?.trim())
  expect(recordedMetric).toBe('Temperature')
  expect(recordedValue).toBe('31 °C')
  const modalWidth = await alertDialog.evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth }))
  expect(modalWidth.scroll).toBeLessThanOrEqual(modalWidth.client)
  await expect(alertDialog.getByText('26 °C', { exact: true })).toBeVisible()
  await expect(alertDialog.getByText('30 °C', { exact: true })).toBeVisible()
  await expect(alertDialog.getByText('Above Maximum Threshold')).toBeVisible()
  await expect(alertDialog.getByText('The recorded Temperature exceeds the maximum threshold by 1 °C.')).toBeVisible()
  await expect(alertDialog.getByText('70%', { exact: true })).toBeVisible()
  await expect(alertDialog.getByText('4,049', { exact: true })).toBeVisible()
  await expect(alertDialog).not.toContainText('"limits"')
  await page.screenshot({ path: test.info().outputPath('admin-alert-details.png'), fullPage: false })
  const severityValue = await alertDialog.locator('dt').filter({ hasText: 'Severity' })
    .evaluate((element) => element.nextElementSibling?.textContent?.trim())
  expect(severityValue).toBe('—')
  await expect(alertDialog.getByRole('button', { name: /Mark as Reviewing|Resolve/ })).toHaveCount(0)

  const closeIcon = alertDialog.getByRole('button', { name: 'Close alert details' })
  const closeFooter = alertDialog.getByRole('button', { name: 'Close', exact: true })
  await expect(closeIcon).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(closeFooter).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(closeIcon).toBeFocused()
  await closeIcon.click()
  await expect(alertDialog).toHaveCount(0)
  await expect(alertView).toBeFocused()
  expect(detailCalls).toBe(2)

  await page.setViewportSize({ width: 1440, height: 1000 })
  const deviceView = page.locator('.admin-reading-table tbody tr')
    .filter({ hasText: fixture.deviceId })
    .getByRole('button', { name: 'View', exact: true })
  await expect(deviceView).toBeVisible()
  await deviceView.click()
  const deviceDialog = page.getByRole('dialog', { name: 'Synthetic Admin Alert Sensor' })
  await expect(deviceDialog).toBeVisible()
  const deviceCloseIcon = deviceDialog.getByRole('button', { name: 'Close sensor details' })
  await expect(deviceCloseIcon).toBeFocused()
  await page.screenshot({ path: test.info().outputPath('admin-device-details.png'), fullPage: true })
  await page.keyboard.press('Shift+Tab')
  await expect(deviceDialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(deviceCloseIcon).toBeFocused()
  await expect(deviceDialog.locator('dt').filter({ hasText: 'Device Type' }).locator('xpath=following-sibling::dd'))
    .toHaveText('Sensor')
  for (const label of ['Serial Number', 'Location Description', 'Installed At']) {
    const value = await deviceDialog.locator('dt').filter({ hasText: label })
      .evaluate((element) => element.nextElementSibling?.textContent?.trim())
    expect(value).toBe('—')
  }
  await deviceCloseIcon.click()
  await expect(deviceDialog).toHaveCount(0)
  await expect(deviceView).toBeFocused()
  expect(pageErrors, 'no uncaught page errors through the modal flows').toEqual([])
  expect(await page.evaluate(() => window.__niahUnhandledRejections), 'no unhandled rejections through the modal flows').toEqual([])
})
test('Admin notification bell dispatches fetch, retries, renders and marks a synthetic notice read', async ({ page }) => {
  const pageErrors = []
  const notificationRequests = []
  const notificationResponses = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.origin === origin && url.pathname.startsWith('/api/data/staff-notifications'))
      notificationRequests.push({ path: url.pathname, method: request.method() })
  })
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (url.origin === origin && url.pathname.startsWith('/api/data/staff-notifications'))
      notificationResponses.push({ path: url.pathname, status: response.status() })
  })
  await page.addInitScript(() => {
    window.__niahUnhandledRejections = []
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason
      window.__niahUnhandledRejections.push(reason instanceof Error ? reason.message : String(reason))
    })
  })
  await guardResponsiveNetwork(page)
  const fixture = await seedAdminNotificationFixture()
  let allowListSuccess = false
  await page.route((url) => url.origin === origin && url.pathname === '/api/data/staff-notifications' && url.searchParams.get('limit') === '20', async (route) => {
    if (!allowListSuccess) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic transient failure.' }) })
      return
    }
    await route.continue()
  })
  const initialListFailure = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/data/staff-notifications' && response.status() === 503,
  )
  await uiLogin(page, 'admin')
  await initialListFailure
  await expect.poll(() => notificationResponses.some(({ path, status }) => path.endsWith('/unread-count') && status === 200)).toBe(true)

  const bell = page.locator('.notification-button')
  await expect(bell).toBeVisible()
  await bell.click()
  const menu = page.locator('#admin-notifications')
  await expect(menu.getByRole('alert')).toContainText('Notifications could not be loaded.')
  const retry = menu.getByRole('button', { name: 'Retry', exact: true })
  await expect(retry).toBeVisible()
  const listsBeforeRetry = notificationRequests.filter(({ path, method }) => path === '/api/data/staff-notifications' && method === 'GET').length
  allowListSuccess = true
  const successfulList = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/data/staff-notifications' && response.status() === 200,
  )
  await retry.click()
  const successfulResponse = await successfulList
  expect(successfulResponse.status()).toBe(200)
  await expect(bell).toHaveAttribute('aria-expanded', 'true')
  await expect(menu).toBeVisible()
  await expect.poll(() => notificationRequests.filter(({ path, method }) => path === '/api/data/staff-notifications' && method === 'GET').length).toBeGreaterThan(listsBeforeRetry)
  await expect(menu.getByText(fixture.accountName, { exact: false })).toBeVisible()
  await expect(menu.locator('.notification-item')).toHaveCount(1)
  await page.screenshot({ path: test.info().outputPath('admin-notifications-loaded.png'), fullPage: true })

  const readResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/data/staff-notifications/${fixture.notificationId}/read`,
  )
  await menu.locator('.notification-item').click()
  expect((await readResponse).status()).toBe(200)
  expect(notificationRequests).toContainEqual({
    path: `/api/data/staff-notifications/${fixture.notificationId}/read`,
    method: 'POST',
  })
  expect(notificationRequests).toContainEqual({ path: '/api/data/staff-notifications/unread-count', method: 'GET' })
  expect(notificationResponses.some(({ path, status }) => path.endsWith('/unread-count') && status === 200)).toBe(true)
  expect(pageErrors, 'no uncaught browser errors').toEqual([])
  await expect.poll(async () => page.evaluate(() => window.__niahUnhandledRejections)).toEqual([])
})

test('Officer threat notifications play one unlocked sound only for newly polled sensor or camera alerts', async ({ page }) => {
  monitor(page)
  await guardResponsiveNetwork(page)
  await page.addInitScript(() => {
    window.__niahAudioStats = { contexts: 0, resumes: 0, starts: 0 }
    class SyntheticAudioContext {
      state = 'suspended'
      currentTime = 1
      destination = {}
      constructor() { window.__niahAudioStats.contexts++ }
      resume() { window.__niahAudioStats.resumes++; this.state = 'running'; return Promise.resolve() }
      close() { this.state = 'closed'; return Promise.resolve() }
      createOscillator() {
        return { type: '', frequency: { setValueAtTime() {} }, connect() {}, start() { window.__niahAudioStats.starts++ }, stop() {} }
      }
      createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} } }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: SyntheticAudioContext })
  })

  const threat = (id, alertId, source, metric, readAt = null, alertStatus = 'New') => ({
    id, event_type: 'threat_alert_created', created_at: '2026-11-25T01:00:00.000Z', read_at: readAt,
    alert_status: alertStatus,
    species_review_required: false,
    resource: { kind: 'threat_alert', id: alertId },
    threat_context: { source, metric, value: source === 'Sensor' ? 31 : 1, device_id: source === 'Sensor' ? 'synthetic-sensor' : 'synthetic-camera', reading_id: source === 'Sensor' ? `reading-${alertId}` : null, camera_id: source === 'Camera' ? `camera-${alertId}` : null },
  })
  const submission = { id: '00000000-0000-4000-8000-000000000001', event_type: 'registration_submitted', created_at: '2026-11-25T01:00:00.000Z', read_at: null, species_review_required: false, resource: { kind: 'observation', id: '1' } }
  const existingAlert = threat('00000000-0000-4000-8000-000000000002', 'existing-alert', 'Sensor', 'temperature')
  let notifications = [existingAlert, submission]
  let listRequests = 0
  await page.route((url) => url.origin === origin && url.pathname === '/api/data/staff-notifications', async (route) => {
    listRequests++
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      notifications, unread_count: notifications.filter((item) => !item.read_at).length,
      page: { has_more: false, next_cursor: null }, read_through: 'synthetic-read-boundary',
    }) })
  })
  await page.route((url) => url.origin === origin && url.pathname === '/api/data/staff-notifications/unread-count', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ unread_count: notifications.filter((item) => !item.read_at).length }) }),
  )
  // Dashboard startup catalogue calls are unrelated to the notification behavior
  // and can lack tables in the disposable fixture; keep this scenario synthetic.
  await page.route((url) => url.origin === origin && ['/api/plants', '/api/data/plants'].includes(url.pathname), (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ plants: [] }) }),
  )

  await uiLogin(page, 'officer')
  const bell = page.locator('.notification-button')
  await expect(bell).toBeVisible()
  await expect.poll(() => listRequests).toBeGreaterThan(0)
  await bell.click() // A real user gesture unlocks the synthetic AudioContext.
  await expect(page.locator('.notification-item')).toHaveCount(2)
  await expect.poll(() => page.evaluate(() => window.__niahAudioStats.resumes)).toBe(1)
  expect(await page.evaluate(() => window.__niahAudioStats.starts)).toBe(0, 'initial load and existing alerts are silent')

  const poll = async () => {
    await page.waitForTimeout(1100) // Respect the inbox focus-refresh throttle.
    const before = listRequests
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect.poll(() => listRequests).toBeGreaterThan(before)
  }
  notifications = [existingAlert, submission,
    threat('00000000-0000-4000-8000-000000000003', 'new-sensor-alert', 'Sensor', 'temperature'),
    threat('00000000-0000-4000-8000-000000000004', 'new-camera-alert', 'Camera', 'human_detected')]
  await poll()
  await expect.poll(() => page.evaluate(() => window.__niahAudioStats.starts)).toBe(1)

  await poll()
  expect(await page.evaluate(() => window.__niahAudioStats.starts)).toBe(1, 'repeated polling and existing alerts must not replay')

  // Read/status changes on existing alerts and new ordinary submissions are silent.
  notifications = [threat(existingAlert.id, 'existing-alert', 'Sensor', 'temperature', '2026-11-25T01:05:00.000Z', 'Under Review'), submission,
    threat('00000000-0000-4000-8000-000000000003', 'new-sensor-alert', 'Sensor', 'temperature'),
    threat('00000000-0000-4000-8000-000000000004', 'new-camera-alert', 'Camera', 'human_detected'),
    { ...submission, id: '00000000-0000-4000-8000-000000000005', resource: { kind: 'observation', id: '2' } }]
  await poll()
  expect(await page.evaluate(() => window.__niahAudioStats.starts)).toBe(1, 'status changes and normal submission notices must not sound')
})
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
  const expected={'/admin/users':'/api/admin/users','/admin/roles':'/api/admin/permissions','/admin/activity':'/api/admin/audit','/conservation/species':'/api/species','/conservation/reports':'/api/data/reports'}[path];
  if(expected)expect(requested,'Page must load its data from the authenticated API').toContain(expected);
  if(path.endsWith('/profile'))await expect(page.getByLabel('Full Name',{exact:true})).toHaveValue(role);
  expect(errors,'Page requests must reach permitted existing endpoints').toEqual([]);
 });
}
