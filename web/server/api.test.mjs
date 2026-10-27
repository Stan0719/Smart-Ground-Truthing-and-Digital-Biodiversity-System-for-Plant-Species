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
    await new Promise((resolve) => server.close(resolve))
    await auth.db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})


test('one-hour issued credentials expire; permanent Botanist shares independent web/mobile sessions',async()=>{
 const {createStaffInvitations}=await import('./activation.mjs');const auth=await createTestAuth();let server,otherServer;const origin='http://localhost:5173';let delivered;
 try{
 const staff=createStaffInvitations({auth,origin,deliver:async value=>{delivered=value}});
 const issued=await staff.invite({name:'Shared Botanist',username:'shared-botanist',email:'shared@example.invalid',role:'Botanist'},'fixture-admin','fixture');assert.equal(issued.delivery,'sent');
 const expiry=await auth.db.prepare('SELECT expires_at FROM activation_tokens WHERE user_id=? AND used=0').get(issued.user.id);assert.ok(Number(expiry.expires_at)>Date.now()+3590000&&Number(expiry.expires_at)<=Date.now()+3600000);
 server=createAuthServer({auth,env:{APP_ORIGIN:origin,NODE_ENV:'test'}}).listen(0,'127.0.0.1');await once(server,'listening');
 const request=async(path,body,cookie='',bearer='',native=false,port=server.address().port)=>fetch('http://127.0.0.1:'+port+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(!native?{Origin:origin}:{}),...(cookie?{Cookie:cookie}:{}),...(bearer?{Authorization:'Bearer '+bearer}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const first=await request('/api/auth/login',{email:issued.user.email,password:delivered.temporaryPassword});assert.equal(first.status,200);const cookie=first.headers.get('set-cookie').split(';')[0];
 assert.equal((await request('/api/mobile/password',{email:issued.user.email,password:delivered.temporaryPassword},'','',true)).status,401);
 await auth.db.prepare('UPDATE activation_tokens SET expires_at=? WHERE user_id=?').run(Date.now()-1,issued.user.id);
 assert.equal((await request('/api/auth/login',{email:issued.user.email,password:delivered.temporaryPassword})).status,401);
 assert.equal((await request('/api/auth/me',undefined,cookie)).status,401);
 await auth.db.prepare('UPDATE activation_tokens SET expires_at=? WHERE user_id=?').run(Date.now()+3600000,issued.user.id);
 assert.equal((await request('/api/auth/password',{password:'Permanent shared account password!'},cookie)).status,200);
 assert.equal((await request('/api/auth/login',{email:issued.user.email,password:delivered.temporaryPassword})).status,401);
 const web=await request('/api/auth/login',{email:issued.user.email,password:'Permanent shared account password!'});const webCookie=web.headers.get('set-cookie').split(';')[0];
 const mobile=await request('/api/mobile/password',{email:issued.user.email,password:'Permanent shared account password!'},'','',true);assert.equal(mobile.status,200);assert.equal(mobile.headers.get('set-cookie'),null);const session=await mobile.json();assert.equal(session.user.id,issued.user.id);assert.equal(session.user.role,'botanist');
 assert.equal((await request('/api/auth/me',undefined,webCookie)).status,200);
 assert.equal((await request('/api/mobile/me',{},'',session.token,true)).status,200);
 assert.equal((await request('/api/mobile/me',{},webCookie,'',true)).status,403);
 assert.equal((await request('/api/mobile/logout',{},'',session.token,true)).status,200);
 assert.equal((await request('/api/auth/me',undefined,webCookie)).status,200);
 const second=await(await request('/api/mobile/password',{email:issued.user.email,password:'Permanent shared account password!'},'','',true)).json();
 await request('/api/auth/logout',{},webCookie);
 assert.equal((await request('/api/mobile/me',{},'',second.token,true)).status,200);
 otherServer=createAuthServer({auth:await createAuth(auth.db),env:{APP_ORIGIN:origin,NODE_ENV:'test'}}).listen(0,'127.0.0.1');await once(otherServer,'listening');
 assert.equal((await request('/api/mobile/me',{},'',second.token,true,otherServer.address().port)).status,200);
 }finally{for(const s of [server,otherServer])if(s){s.closeAllConnections();await new Promise(r=>s.close(r))}await auth.db.close()}
});


test('only Administrator can initiate another account recovery without changing its password',async()=>{
 const auth=await createTestAuth();let server,calls=0;try{const accounts={};for(const [key,role]of[['admin','Administrator'],['officer','Conservation Officer'],['bot','Botanist']])accounts[key]=await auth.createUser({name:key,email:key+'@recovery.invalid',password:'Fixture original password!',role,mustChangePassword:false});
 const before=(await auth.byId(accounts.bot.id)).password_hash;
 server=createAuthServer({auth,recovery:{request:async email=>{calls++;assert.equal(email,accounts.bot.email);return {status:202,message:'Recovery requested.'}}},env:{NODE_ENV:'test',APP_ORIGIN:'http://localhost:5173'}}).listen(0,'127.0.0.1');await once(server,'listening');
 for(const [key,status]of[['officer',403],['bot',403],['admin',202]]){const session=await auth.login(accounts[key].email,'Fixture original password!',key);const result=await fetch('http://127.0.0.1:'+server.address().port+'/api/admin/users/'+accounts.bot.id+'/reset',{method:'POST',headers:{Origin:'http://localhost:5173','Content-Type':'application/json',Cookie:'niah_session='+session.token},body:'{}'});assert.equal(result.status,status)}
 assert.equal(calls,1);assert.equal((await auth.byId(accounts.bot.id)).password_hash,before);
 const mobileOfficer=await fetch('http://127.0.0.1:'+server.address().port+'/api/mobile/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:accounts.officer.email,password:'Fixture original password!'})});assert.equal(mobileOfficer.status,200);assert.equal((await mobileOfficer.json()).user.role,'conservation-officer');
 const mobileAdmin=await fetch('http://127.0.0.1:'+server.address().port+'/api/mobile/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:accounts.admin.email,password:'Fixture original password!'})});assert.equal(mobileAdmin.status,401);

 }finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r))}await auth.db.close()}
});
