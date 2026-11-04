import { createTestAuth } from './test-postgres.mjs'
import { createAuthServer } from './http.mjs'
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
  const auth = await createTestAuth()
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
  const server = createAuthServer({
    auth,
    env: {
      NODE_ENV: 'test',
      CODESPACE_NAME: 'test-workspace',
      GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev',
    },
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const port = server.address().port
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
    assert.equal((await request('/admin/audit')).status, 401)
    assert.equal((await request('/admin/audit', 'GET', undefined, officerCookie)).status, 403)
    const audit = await request('/admin/audit', 'GET', undefined, adminCookie)
    assert.equal(audit.status, 200)
    assert.ok(Array.isArray((await audit.json()).events))
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
    // Becoming a Botanist revokes browser access; native mobile login still works.
    assert.equal((await request('/auth/login', 'POST', {
      email: officer.email, password: 'officer password value',
    })).status, 401)
    const editedLogin = await fetch(`http://127.0.0.1:${port}/api/mobile/password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: officer.email, password: 'officer password value' }),
    })
    assert.equal(editedLogin.status, 200)
    const editedUser = await editedLogin.json()
    assert.equal(editedUser.user.name, 'Updated Officer')
    assert.equal(editedUser.user.role, 'botanist')
    const editedCookie = `niah_session=${editedUser.token}`
    assert.equal(
      (await request(`/admin/users/${officer.id}`, 'DELETE', {}, editedCookie)).status,
      401,
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
    await new Promise((resolve) => server.close(resolve))
    await auth.db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})


test('one-hour Botanist credentials expire; mobile-only first login and independent native sessions', async () => {
  const { createStaffInvitations } = await import('./activation.mjs')
  const auth = await createTestAuth()
  const origin = 'http://localhost:5173'
  let server, otherServer, delivered
  try {
    const staff = createStaffInvitations({ auth, origin, deliver: async value => { delivered = value } })
    const issued = await staff.invite({ name: 'Mobile Botanist', username: 'mobile-botanist', email: 'shared@example.invalid', role: 'Botanist' }, 'fixture-admin', 'fixture')
    assert.equal(issued.delivery, 'sent')
    const expiry = await auth.db.prepare('SELECT expires_at FROM activation_tokens WHERE user_id=? AND used=0').get(issued.user.id)
    assert.ok(Number(expiry.expires_at) > Date.now() + 3590000 && Number(expiry.expires_at) <= Date.now() + 3600000)
    server = createAuthServer({ auth, env: { APP_ORIGIN: origin, NODE_ENV: 'test' } }).listen(0, '127.0.0.1')
    await once(server, 'listening')
    const request = (path, body, token = '', browser = false, port = server.address().port) => fetch(`http://127.0.0.1:${port}/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(browser ? { Origin: origin, ...(token ? { Cookie: `niah_session=${token}` } : {}) } : token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const credentials = { email: issued.user.email, password: delivered.temporaryPassword }
    assert.equal((await request('/auth/login', credentials, '', true)).status, 401)
    const first = await request('/mobile/password', credentials)
    assert.equal(first.status, 200)
    assert.equal(first.headers.get('set-cookie'), null)
    const temporary = await first.json()
    assert.equal(temporary.user.mustChangePassword, true)
    assert.equal((await request('/mobile/me', undefined, temporary.token)).status, 403)
    await auth.db.prepare('UPDATE activation_tokens SET expires_at=? WHERE user_id=?').run(Date.now() - 1, issued.user.id)
    assert.equal((await request('/mobile/password', credentials)).status, 401)
    assert.equal((await request('/mobile/me', undefined, temporary.token)).status, 401)
    await auth.db.prepare('UPDATE activation_tokens SET expires_at=? WHERE user_id=?').run(Date.now() + 3600000, issued.user.id)
    const permanent = 'Permanent shared account password!'
    assert.equal((await request('/mobile/change-password', { password: permanent }, temporary.token)).status, 200)
    assert.equal((await request('/mobile/me', undefined, temporary.token)).status, 401)
    assert.equal((await request('/mobile/password', credentials)).status, 401)
    const login = () => request('/mobile/password', { email: issued.user.email, password: permanent })
    const mobile = await login()
    assert.equal(mobile.status, 200)
    const session = await mobile.json()
    assert.equal(session.user.id, issued.user.id)
    assert.equal(session.user.role, 'botanist')
    assert.equal((await request('/mobile/me', undefined, session.token)).status, 200)
    assert.equal((await request('/auth/login', { email: issued.user.email, password: permanent }, '', true)).status, 401)
    assert.equal((await request('/auth/me', undefined, session.token, true)).status, 401)
    assert.equal((await request('/mobile/me', undefined, session.token, true)).status, 401)
    const second = await (await login()).json()
    assert.ok(second.token && second.token !== session.token)
    assert.equal((await request('/mobile/logout', {}, session.token)).status, 200)
    assert.equal((await request('/mobile/me', undefined, session.token)).status, 401)
    assert.equal((await request('/mobile/me', undefined, second.token)).status, 200)
    otherServer = createAuthServer({ auth: await createAuth(auth.db), env: { APP_ORIGIN: origin, NODE_ENV: 'test' } }).listen(0, '127.0.0.1')
    await once(otherServer, 'listening')
    assert.equal((await request('/mobile/me', undefined, second.token, false, otherServer.address().port)).status, 200)
  } finally {
    for (const current of [server, otherServer]) if (current) { current.closeAllConnections(); await new Promise(resolve => current.close(resolve)) }
    await auth.db.close()
  }
})


test('only Administrator can initiate another account recovery without changing its password',async()=>{
 const auth=await createTestAuth();let server,calls=0;try{const accounts={};for(const [key,role]of[['admin','Administrator'],['officer','Conservation Officer'],['bot','Botanist']])accounts[key]=await auth.createUser({name:key,email:key+'@recovery.invalid',password:'Fixture original password!',role,mustChangePassword:false});
 const before=(await auth.byId(accounts.bot.id)).password_hash;
 server=createAuthServer({auth,recovery:{request:async email=>{calls++;assert.equal(email,accounts.bot.email);return {status:202,message:'Recovery requested.'}}},env:{NODE_ENV:'test',APP_ORIGIN:'http://localhost:5173'}}).listen(0,'127.0.0.1');await once(server,'listening');
 for(const [key,status]of[['officer',403],['bot',401],['admin',202]]){const session=await auth.login(accounts[key].email,'Fixture original password!',key);const result=await fetch('http://127.0.0.1:'+server.address().port+'/api/admin/users/'+accounts.bot.id+'/reset',{method:'POST',headers:{Origin:'http://localhost:5173','Content-Type':'application/json',Cookie:'niah_session='+session.token},body:'{}'});assert.equal(result.status,status)}
 assert.equal(calls,1);assert.equal((await auth.byId(accounts.bot.id)).password_hash,before);
 const mobileOfficer=await fetch('http://127.0.0.1:'+server.address().port+'/api/mobile/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:accounts.officer.email,password:'Fixture original password!'})});assert.equal(mobileOfficer.status,200);assert.equal((await mobileOfficer.json()).user.role,'conservation-officer');
 const mobileAdmin=await fetch('http://127.0.0.1:'+server.address().port+'/api/mobile/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:accounts.admin.email,password:'Fixture original password!'})});assert.equal(mobileAdmin.status,401);

 }finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r))}await auth.db.close()}
});
