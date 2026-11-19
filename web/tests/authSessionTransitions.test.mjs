import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// Fresh module state and mocked fetch only: no credentials or live API requests.
const source = readFileSync(new URL('../src/services/auth.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const user = { id: 'fixture', role: 'Conservation Officer', status: 'Active', mustChangePassword: false }
function harness(fetch) {
  const exports = {}
  vm.runInNewContext(compiled, { exports, fetch })
  return exports
}
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const failures = {
  http: () => Response.json({ error: 'Fixture denied.' }, { status: 401 }),
  network: () => { throw new Error('Fixture offline.') },
  parsing: () => new Response('invalid json', { status: 200 }),
}

for (const route of ['login', 'logout']) {
  for (const [kind, fail] of Object.entries(failures)) {
    test(`failed ${route} (${kind}) permits a fresh successful currentUser verification`, async () => {
      const calls = []
      const auth = harness(async (url, options) => {
        calls.push({ url, options })
        return url === '/api/auth/me' ? Response.json({ user }) : fail()
      })
      await auth.currentUser()
      await assert.rejects(auth.api(`/auth/${route}`, 'POST', {}), error => {
        if (kind === 'http') assert.equal(error.status, 401)
        if (kind === 'network') assert.match(error.message, /Unable to reach the server/)
        return true
      })
      // Failure never restores a previously trusted identity optimistically.
      assert.equal(auth.sessionSnapshot().user, null)
      assert.equal(auth.sessionSnapshot().pending, true)
      const verified = await auth.currentUser()
      assert.equal(verified.id, user.id)
      assert.equal(auth.sessionSnapshot().pending, false)
      assert.equal(calls.filter(c => c.url === '/api/auth/me').length, 2)
      assert.ok(calls.every(c => c.options.credentials === 'same-origin'))
    })
  }
  test(`successful ${route} preserves publication and permits later verification`, async () => {
    const auth = harness(async () => Response.json({ user }))
    await auth.api(`/auth/${route}`, 'POST', {})
    assert.equal(auth.sessionSnapshot().pending, false)
    assert.equal(auth.sessionSnapshot().user?.id ?? null, route === 'login' ? user.id : null)
    assert.equal((await auth.currentUser()).id, user.id)
  })
}

for (const outcome of ['success', ...Object.keys(failures)]) {
  test(`older ${outcome} cannot clear a newer transition or restore its identity`, async () => {
    const old = deferred(), latest = deferred()
    let meCalls = 0
    const auth = harness(async url => {
      if (url === '/api/auth/login') return old.promise
      if (url === '/api/auth/logout') return latest.promise
      meCalls++
      return Response.json({ user })
    })
    const earlier = auth.api('/auth/login', 'POST', {})
    const rejection = assert.rejects(earlier)
    const newer = auth.logout()
    if (outcome === 'network') old.reject(new Error('Fixture offline.'))
    else old.resolve(outcome === 'success' ? Response.json({ user }) : failures[outcome]())
    await rejection
    assert.equal(await auth.currentUser(), null)
    assert.equal(meCalls, 0)
    assert.equal(auth.sessionSnapshot().pending, true)
    assert.equal(auth.sessionSnapshot().user, null)
    latest.resolve(Response.json({}))
    await newer
    assert.equal(auth.sessionSnapshot().pending, false)
    assert.equal((await auth.currentUser()).id, user.id)
  })
}

test('stale login and me responses cannot overwrite recovery after a newer failed logout', async () => {
  const oldLogin = deferred(), oldMe = deferred(), newLogout = deferred()
  let meCalls = 0
  const auth = harness(async url => {
    if (url === '/api/auth/login') return oldLogin.promise
    if (url === '/api/auth/logout') return newLogout.promise
    return ++meCalls === 1 ? oldMe.promise : Response.json({ user })
  })
  const verification = auth.currentUser()
  const login = auth.api('/auth/login', 'POST', {})
  const staleLoginRejected = assert.rejects(login, /session changed/)
  const logout = auth.logout()
  const failedLogout = assert.rejects(logout)
  newLogout.reject(new Error('Fixture offline.'))
  await failedLogout
  assert.equal((await auth.currentUser()).id, user.id)
  oldLogin.resolve(Response.json({ user: { ...user, id: 'old-login' } }))
  oldMe.resolve(Response.json({ user: { ...user, id: 'old-me' } }))
  await staleLoginRejected
  assert.equal(await verification, null)
  assert.equal(auth.sessionSnapshot().user.id, user.id)
  assert.equal(auth.sessionSnapshot().pending, false)
})

test('a transition started by a session listener retains its own generation', async () => {
  const old = deferred(), latest = deferred()
  const auth = harness(async url => url === '/api/auth/login' ? old.promise :
    url === '/api/auth/logout' ? latest.promise : Response.json({ user }))
  await auth.currentUser()
  let newer
  const unsubscribe = auth.subscribeSession((_user, pending) => {
    if (pending && !newer) newer = auth.logout()
  })
  const earlier = auth.api('/auth/login', 'POST', {})
  const rejected = assert.rejects(earlier, /session changed/)
  old.resolve(Response.json({ user }))
  await rejected
  assert.equal(await auth.currentUser(), null)
  assert.equal(auth.sessionSnapshot().pending, true)
  unsubscribe()
  latest.resolve(Response.json({}))
  await newer
  assert.equal(auth.sessionSnapshot().pending, false)
  assert.equal(auth.sessionSnapshot().user, null)
})


for (const failure of [403, 429, 500, 502, 503, 504, 'network', 'invalid-json', 'invalid-user']) {
  test(`temporary verification ${failure} retains verified identity, blocks API work and recovers`, async () => {
    let mode = 'success', calls = 0
    const auth = harness(async () => {
      calls++
      if (mode === 'network') throw Error('offline')
      if (mode === 'invalid-json') return new Response('invalid')
      if (mode === 'invalid-user') return Response.json({ user: { id: user.id } })
      return mode === 'success' ? Response.json({ user }) : Response.json({ error: 'fixture' }, { status: mode })
    })
    assert.equal((await auth.verifySession()).status, 'authenticated')
    mode = failure
    const result = await auth.verifySession()
    assert.equal(result.status, 'unavailable'); assert.equal(auth.sessionVerificationCurrent(result), true)
    assert.equal(auth.sessionSnapshot().user.id, user.id)
    assert.equal(auth.sessionSnapshot().pending, true); assert.equal(auth.sessionSnapshot().unavailable, true)
    const before = calls
    await assert.rejects(auth.api('/admin/users', 'POST', {}), /temporarily unavailable/)
    assert.equal(calls, before)
    mode = 'success'
    assert.equal((await auth.verifySession()).status, 'authenticated')
    assert.equal(auth.sessionSnapshot().pending, false); assert.equal(auth.sessionSnapshot().unavailable, false)
  })
}

test('unknown identity is never invented during unavailable verification; explicit 401 clears a known identity', async () => {
  let mode = 503
  const auth = harness(async () => mode === 200 ? Response.json({user}) : Response.json({error:'fixture'},{status:mode}))
  assert.equal((await auth.verifySession()).status,'unavailable');assert.equal(auth.sessionSnapshot().user,null)
  mode=200;await auth.verifySession();mode=401
  assert.equal((await auth.verifySession()).status,'unauthenticated')
  assert.equal(auth.sessionSnapshot().user,null);assert.equal(auth.sessionSnapshot().pending,false)
})
