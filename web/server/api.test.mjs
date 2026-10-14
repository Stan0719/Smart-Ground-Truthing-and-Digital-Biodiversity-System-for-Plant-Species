import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { createAuth, LOGIN_ERROR } from './auth.mjs'

test('HTTP API enforces status, role, cookies, origin and revocation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'niah-auth-'))
  const filename = join(directory, 'test.sqlite')
  const auth = await createAuth(filename)
  await auth.createUser({
    name: 'Admin',
    email: 'admin@example.com',
    role: 'Administrator',
    password: 'admin password value',
    mustChangePassword: false,
  })
  const officer = await auth.createUser({
    name: 'Officer',
    email: 'officer@example.com',
    role: 'Conservation Officer',
    password: 'officer password value',
    mustChangePassword: false,
  })
  const pending = await auth.createUser({
    name: 'Pending',
    email: 'pending@example.com',
    role: 'Administrator',
    password: 'pending password value',
  })
  const testEnv = {
    ...process.env,
    AUTH_DB: filename,
    PORT: '0',
    NODE_ENV: 'test',
    CODESPACE_NAME: 'test-workspace',
    GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev',
  }
  delete testEnv.APP_ORIGIN
  const child = spawn(process.execPath, ['server/index.mjs'], {
    env: testEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let startupError = ''
  child.stderr.on('data', (chunk) => {
    startupError += chunk
  })
  const exited = once(child, 'exit')
  try {
    const started = await Promise.race([
      once(child.stdout, 'data'),
      exited.then(() => {
        throw new Error('API exited early: ' + startupError)
      }),
      new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error('API startup timed out')), 10000)
        timer.unref()
      }),
    ])
    const port = /port (\d+)/.exec(String(started[0]))?.[1]
    assert.ok(port && port !== '0')
    const request = (path, method = 'GET', body, cookie = '', origin = 'http://localhost:5173') =>
      fetch(`http://127.0.0.1:${port}/api${path}`, {
        method,
        headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    const login = async (email, password) => {
      const response = await request('/auth/login', 'POST', { email, password })
      assert.equal(response.status, 200)
      assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/)
      return response.headers.get('set-cookie').split(';')[0]
    }
    const codespacesLogin = await request(
      '/auth/login',
      'POST',
      { email: 'admin@example.com', password: 'admin password value' },
      '',
      'https://test-workspace-5173.app.github.dev',
    )
    assert.equal(codespacesLogin.status, 200)
    const foreignWorkspace = await request(
      '/auth/login',
      'POST',
      { email: 'admin@example.com', password: 'admin password value' },
      '',
      'https://other-workspace-5173.app.github.dev',
    )
    assert.equal(foreignWorkspace.status, 403)
    const missingOrigin = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: 'admin password value' }),
    })
    assert.equal(missingOrigin.status, 403)
    assert.equal((await request('/admin/users')).status, 401)
    const adminCookie = await login('admin@example.com', 'admin password value')
    const officerCookie = await login(officer.email, 'officer password value')
    assert.equal((await request('/admin/users', 'GET', undefined, officerCookie)).status, 403)
    assert.equal((await request('/admin/users', 'GET', undefined, adminCookie)).status, 200)
    assert.equal(
      (
        await request(
          `/admin/users/${officer.id}/status`,
          'PATCH',
          { status: 'Suspended' },
          adminCookie,
          'https://evil.example',
        )
      ).status,
      403,
    )
    assert.equal(
      (
        await request(
          `/admin/users/${officer.id}/status`,
          'PATCH',
          { status: 'Suspended' },
          adminCookie,
        )
      ).status,
      200,
    )
    assert.equal((await request('/auth/me', 'GET', undefined, officerCookie)).status, 401)
    const denied = await request('/auth/login', 'POST', {
      email: officer.email,
      password: 'officer password value',
    })
    assert.equal(denied.status, 401)
    assert.equal((await denied.json()).error, LOGIN_ERROR)
    await request(`/admin/users/${officer.id}/status`, 'PATCH', { status: 'Active' }, adminCookie)
    assert.equal((await request('/auth/me', 'GET', undefined, officerCookie)).status, 401)
    const renewedOfficerCookie = await login(officer.email, 'officer password value')
    assert.equal(
      (
        await request(
          `/admin/users/${officer.id}`,
          'PATCH',
          { name: 'Updated Officer', email: officer.email, role: 'Botanist', status: 'Active' },
          renewedOfficerCookie,
        )
      ).status,
      403,
    )
    assert.equal(
      (
        await request(
          `/admin/users/${officer.id}`,
          'PATCH',
          { name: 'Updated Officer', email: officer.email, role: 'Botanist', status: 'Suspended' },
          adminCookie,
        )
      ).status,
      200,
    )
    assert.equal((await request('/auth/me', 'GET', undefined, renewedOfficerCookie)).status, 401)
    assert.equal(
      (
        await request('/auth/login', 'POST', {
          email: officer.email,
          password: 'officer password value',
        })
      ).status,
      401,
    )
    assert.equal(
      (
        await request(
          `/admin/users/${officer.id}`,
          'PATCH',
          { name: 'Updated Officer', email: officer.email, role: 'Botanist', status: 'Active' },
          adminCookie,
        )
      ).status,
      200,
    )
    const editedCookie = await login(officer.email, 'officer password value')
    const editedUser = await (await request('/auth/me', 'GET', undefined, editedCookie)).json()
    assert.equal(editedUser.user.name, 'Updated Officer')
    assert.equal(editedUser.user.role, 'Botanist')
    assert.equal(
      (await request(`/admin/users/${officer.id}`, 'DELETE', {}, editedCookie)).status,
      403,
    )
    const adminId = (await (await request('/auth/me', 'GET', undefined, adminCookie)).json()).user
      .id
    assert.equal((await request(`/admin/users/${adminId}`, 'DELETE', {}, adminCookie)).status, 400)
    assert.equal(
      (
        await request(
          `/admin/users/${adminId}`,
          'PATCH',
          { name: 'Admin', email: 'admin@example.com', role: 'Botanist', status: 'Active' },
          adminCookie,
        )
      ).status,
      400,
    )
    assert.equal(
      (await request(`/admin/users/${officer.id}`, 'DELETE', {}, adminCookie)).status,
      200,
    )
    assert.equal((await request('/auth/me', 'GET', undefined, editedCookie)).status, 401)
    assert.equal(
      (
        await request('/auth/login', 'POST', {
          email: officer.email,
          password: 'officer password value',
        })
      ).status,
      401,
    )
    const pendingCookie = await login(pending.email, 'pending password value')
    assert.equal((await request('/admin/users', 'GET', undefined, pendingCookie)).status, 403)
    assert.equal(
      (
        await request(
          '/auth/password',
          'POST',
          { password: 'new long password value' },
          pendingCookie,
        )
      ).status,
      200,
    )
    assert.equal((await request('/auth/me', 'GET', undefined, pendingCookie)).status, 401)
    assert.equal((await request('/auth/logout', 'POST', {}, adminCookie)).status, 200)
    assert.equal((await request('/admin/users', 'GET', undefined, adminCookie)).status, 401)
  } finally {
    if (child.exitCode === null) child.kill()
    await exited
    auth.db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
