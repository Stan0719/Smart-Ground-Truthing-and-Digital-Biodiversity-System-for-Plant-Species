export const INACTIVITY_MS = 30 * 24 * 60 * 60 * 1000

export function createAccountInactivity({ db, event, now }) {
  const lock = () => db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get('account-inactivity-policy')
  const loginTime = value => {
    // Existing successful logins write ISO UTC strings. Do not parse display text
    // such as "Never" or assume the timezone of ambiguous legacy timestamps.
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT.*Z$/.test(value)) return null
    const stamp = Date.parse(value)
    return Number.isFinite(stamp) && stamp <= now() ? stamp : null
  }
  const apply = async account => {
    if (!account || account.status !== 'Active' || account.must_change_password) return account
    const lastLogin = loginTime(account.last_login)
    if (lastLogin !== null && now() - lastLogin < INACTIVITY_MS) return account
    return db.transaction(async () => {
      await lock()
      const table = account.role === 'Visitor' ? 'visitors' : 'users'
      const current = await db.prepare(`SELECT * FROM ${table} WHERE id=? FOR UPDATE`).get(account.id)
      if (!current || current.status !== 'Active' || current.must_change_password) return current
      const recent = await db.prepare("SELECT MAX(created_at) AS baseline FROM auth_events WHERE user_id=? AND created_at<=? AND reason IN ('account_created','invitation_created','administrator_bootstrap_created','authenticated','face_authenticated','account_reactivated','status_Active','inactivity_grace_started')").get(current.id, now())
      const dates = [loginTime(current.last_login), recent?.baseline == null ? null : Number(recent.baseline)].filter(value => value !== null && Number.isFinite(value))
      if (!dates.length) {
        await event(current.id, null, 'inactivity_grace_started')
        return current
      }
      if (now() - Math.max(...dates) < INACTIVITY_MS) return current
      // Preserve an operational recovery administrator. The common policy lock
      // serializes checks so concurrent requests cannot suspend the last two.
      if (current.role === 'Administrator') {
        const admins = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='Administrator' AND status='Active' AND must_change_password=0").get()
        if (Number(admins.n) <= 1) return current
      }
      const changed = await db.prepare(`UPDATE ${table} SET status='Suspended' WHERE id=? AND status='Active'`).run(current.id)
      if (changed.changes) {
        await db.prepare(`DELETE FROM ${table === 'visitors' ? 'visitor_sessions' : 'sessions'} WHERE user_id=?`).run(current.id)
        await event(current.id, null, 'automatic_inactivity_suspension')
      }
      return { ...current, status: 'Suspended' }
    })
  }
  const reactivated = async (id, previous, next, actor, ip) => {
    if (previous !== 'Active' && next === 'Active') await event(id, ip, 'account_reactivated', actor)
  }
  return { apply, lock, reactivated }
}
