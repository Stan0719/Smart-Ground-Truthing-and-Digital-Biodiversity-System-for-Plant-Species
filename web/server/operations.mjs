import { publicUser } from './auth.mjs'
import policy from '../../shared/rbac.cjs'
const { grants } = policy
export async function adminRequest({ auth, activation, recovery, path, method, body, user, ip }) {
  const db = auth.db
  if (path === '/api/admin/permissions' && method === 'GET')
    return { status: 200, permissions: grants }
  if (path === '/api/admin/audit' && method === 'GET')
    return {
      status: 200,
      events: await db.prepare('SELECT * FROM auth_events ORDER BY id DESC LIMIT 500').all(),
    }
  if (path === '/api/admin/system' && method === 'GET')
    return {
      status: 200,
      system: {
        uptimeSeconds: Math.floor(process.uptime()),
        memoryBytes: process.memoryUsage().rss,
        nodeVersion: process.version,
        accounts: (
          await db
            .prepare('SELECT (SELECT COUNT(*) FROM users)+(SELECT COUNT(*) FROM visitors) AS n')
            .get()
        ).n,
        database: (await db.prepare("SELECT 'postgresql' AS engine").get()).engine,
        time: new Date().toISOString(),
      },
    }
  if (path === '/api/admin/settings') {
    if (method === 'GET')
      return {
        status: 200,
        settings: await db
          .prepare('SELECT session_hours,login_limit FROM security_settings WHERE id=1')
          .get(),
      }
    if (method === 'PATCH') {
      if (
        !Number.isInteger(body.session_hours) ||
        body.session_hours < 1 ||
        body.session_hours > 24 ||
        !Number.isInteger(body.login_limit) ||
        body.login_limit < 5 ||
        body.login_limit > 100
      )
        return { status: 400, error: 'Session hours must be 1–24; login limit 5–100.' }
      await db.transaction(async () => {
        await db
          .prepare('UPDATE security_settings SET session_hours=?,login_limit=? WHERE id=1')
          .run(body.session_hours, body.login_limit)
        await db.exec('DELETE FROM sessions; DELETE FROM visitor_sessions')
        await auth.event(null, ip, 'security_settings_changed', user.id)
      })
      return { status: 200, reauthenticate: true }
    }
  }
  if (path === '/api/admin/users' && method === 'GET')
    return {
      status: 200,
      users: [
        ...(await db
          .prepare(
            "SELECT * FROM users WHERE id NOT IN (SELECT user_id FROM auth_events WHERE reason='account_archived' AND user_id IS NOT NULL)",
          )
          .all()),
        ...(await db
          .prepare(
            "SELECT * FROM visitors WHERE id NOT IN (SELECT user_id FROM auth_events WHERE reason='account_archived' AND user_id IS NOT NULL)",
          )
          .all()),
      ]
        .map(publicUser)
        .sort((a, b) => a.name.localeCompare(b.name)),
    }
  if (path === '/api/admin/users' && method === 'POST') return activation.invite(body, user.id, ip)
  const reset=/^\/api\/admin\/users\/([^/]+)\/reset$/.exec(path)
  if(reset&&method==='POST'){
    if(!recovery)return {status:503,error:'Recovery delivery is unavailable.'}
    const target=await auth.byId(reset[1]);if(!target)return {status:404,error:'Account not found.'}
    if(target.status!=='Active'||target.must_change_password)return {status:409,error:'Use the temporary-password workflow for accounts awaiting activation.'}
    const result=await recovery.request(target.email,ip);await auth.event(target.id,ip,'administrator_recovery_requested',user.id);return result
  }
  const match = /^\/api\/admin\/users\/([^/]+)(?:\/(status|resend))?$/.exec(path)
  if (!match) return { status: 404, error: 'Not found.' }
  const id = match[1],
    current = await auth.byId(id),
    action = match[2]
  if (
    !current ||
    (await db
      .prepare("SELECT 1 FROM auth_events WHERE user_id=? AND reason='account_archived'")
      .get(id))
  )
    return { status: 404, error: 'Account not found.' }
  if (action === 'resend' && method === 'POST') return activation.invite(current, user.id, ip, id)
  if (action === 'status' && method === 'PATCH') {
    if (!['Active', 'Inactive', 'Suspended'].includes(body.status))
      return { status: 400, error: 'Invalid status.' }
    if (id === user.id && body.status !== 'Active')
      return { status: 400, error: 'Ask another administrator to disable your account.' }
    return { status: (await auth.setStatus(id, body.status, user.id, ip)) ? 200 : 409 }
  }
  const table = current.role === 'Visitor' ? 'visitors' : 'users',
    sessions = table === 'visitors' ? 'visitor_sessions' : 'sessions'
  if (method === 'DELETE') {
    if (id === user.id) return { status: 400, error: 'You cannot delete your own account.' }
    // Archive without breaking observation, enrollment, or audit references.
    await db.transaction(async () => {
      if (current.status !== 'Pending Activation') await auth.setStatus(id, 'Inactive', user.id, ip)
      await db.prepare(`DELETE FROM ${sessions} WHERE user_id=?`).run(id)
      await db.prepare('UPDATE activation_tokens SET used=1 WHERE user_id=?').run(id)
      await db.prepare('UPDATE password_resets SET used=1 WHERE user_id=?').run(id)
      // Release unique login identifiers so administrators can create a replacement.
      // Keep the immutable ID for historical business/audit references.
      const archivedEmail = `archived-${id}@example.invalid`
      if (table === 'users')
        await db
          .prepare('UPDATE users SET email=?,username=? WHERE id=?')
          .run(archivedEmail, `archived_${id.replaceAll('-', '')}`, id)
      else await db.prepare('UPDATE visitors SET email=? WHERE id=?').run(archivedEmail, id)
      await auth.event(id, ip, 'account_archived', user.id)
    })
    return { status: 200, archived: true }
  }
  if (method !== 'PATCH') return { status: 404, error: 'Not found.' }
  if (
    typeof body.name !== 'string' ||
    !body.name.trim() ||
    body.name.length > 100 ||
    typeof body.email !== 'string' ||
    body.email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) ||
    !(
      table === 'visitors' ? ['Visitor'] : ['Administrator', 'Conservation Officer', 'Botanist']
    ).includes(body.role) ||
    !['Active', 'Inactive', 'Suspended', 'Pending Activation'].includes(body.status)
  )
    return { status: 400, error: 'Enter a valid name, email, role and status.' }
  if ((current.status === 'Pending Activation') !== (body.status === 'Pending Activation'))
    return { status: 409, error: 'Use the activation workflow for pending accounts.' }
  if (id === user.id && (body.role !== current.role || body.status !== current.status))
    return { status: 400, error: 'You cannot change your own role or status.' }
  await db.transaction(async () => {
    await db.prepare(`SELECT id FROM ${table} WHERE id=? FOR UPDATE`).get(id)
    if (
      await db
        .prepare("SELECT 1 FROM auth_events WHERE user_id=? AND reason='account_archived'")
        .get(id)
    )
      throw Object.assign(Error('Account not found.'), { status: 404 })
    await db
      .prepare(`UPDATE ${table} SET name=?,email=?,role=?,status=? WHERE id=?`)
      .run(body.name.trim(), body.email.trim().toLowerCase(), body.role, body.status, id)
    if (current.role !== body.role || current.email !== body.email.trim().toLowerCase())
      await db.prepare(`DELETE FROM ${sessions} WHERE user_id=?`).run(id)
    await auth.event(id, ip, 'account_updated', user.id)
  })
  return { status: 200 }
}
