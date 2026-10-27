import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
export function createRecovery({ auth, deliver, key, now = () => Date.now() }) {
  const hash = (id, code) =>
    createHmac('sha256', key).update(`niah-password-reset\n${id}\n${code}`).digest('hex')
  return {
    async request(email, ip) {
      if (!deliver || !key || key.length < 32)
        return {
          status: 503,
          error: 'Password recovery delivery is not configured. Contact the administrator.',
        }
      if (typeof email !== 'string' || email.length > 254)
        return { status: 400, error: 'Enter a valid email.' }
      const id = randomBytes(16).toString('hex'),
        code = String(randomInt(1000000)).padStart(6, '0')
      const prepared = await auth.db.transaction(async () => {
        await auth.db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get('recovery-ip:' + ip)
        const attempts = (
          await auth.db
            .prepare(
              "SELECT COUNT(*) AS n FROM auth_events WHERE ip=? AND created_at>? AND reason='recovery_request'",
            )
            .get(ip, now() - 15 * 60 * 1000)
        ).n
        if (attempts >= 5) return { limited: true }
        await auth.event(null, ip, 'recovery_request')
        const existing = await auth.byEmail(email.trim().toLowerCase())
        if (!existing) return {}
        const table = existing.role === 'Visitor' ? 'visitors' : 'users'
        const user = await auth.db
          .prepare(`SELECT * FROM ${table} WHERE id=? FOR UPDATE`)
          .get(existing.id)
        if (!user || user.status !== 'Active' || user.must_change_password) return {}
        await auth.db.prepare('UPDATE password_resets SET used=1 WHERE user_id=?').run(user.id)
        await auth.db
          .prepare(
            'INSERT INTO password_resets(id,user_id,kind,code_hash,expires_at) VALUES(?,?,?,?,?)',
          )
          .run(
            id,
            user.id,
            user.role === 'Visitor' ? 'visitor' : 'user',
            hash(id, code),
            now() + 5 * 60 * 1000,
          )
        return { user }
      })
      if (prepared.limited)
        return { status: 429, error: 'Too many recovery requests. Try again later.' }
      if (prepared.user) {
        const user = prepared.user
        // The account transaction commits before delivery is scheduled.
        void Promise.resolve()
          .then(() => deliver(user.email, user.name, code))
          .catch(async () => {
            await auth.db.prepare('UPDATE password_resets SET used=1 WHERE id=?').run(id)
            await auth.event(null, ip, 'recovery_delivery_failed')
          })
          .catch(() => console.error('Recovery delivery status could not be persisted.'))
      }
      return {
        status: 202,
        recoveryId: id,
        message:
          'If an eligible account exists, a recovery code will be sent. Delivery is not confirmed here.',
      }
    },
    async confirm({ recoveryId: requestId, code, password }, ip) {
      if (!key) return { status: 503, error: 'Password recovery is not configured.' }
      if (
        typeof requestId !== 'string' ||
        !/^[a-f0-9]{32}$/.test(requestId) ||
        typeof code !== 'string' ||
        !/^\d{6}$/.test(code) ||
        typeof password !== 'string' ||
        password.length < 15 ||
        password.length > 128
      )
        return {
          status: 400,
          error: 'Use a valid recovery code and a password with 15 to 128 characters.',
        }
      return auth.db.transaction(async () => {
        const row = await auth.db
          .prepare('SELECT * FROM password_resets WHERE id=? FOR UPDATE')
          .get(requestId)
        if (!row || row.used || row.expires_at <= now() || row.attempts >= 5)
          return { status: 401, error: 'Recovery code is invalid or expired.' }
        await auth.db
          .prepare('UPDATE password_resets SET attempts=attempts+1 WHERE id=?')
          .run(requestId)
        if (
          !timingSafeEqual(
            Buffer.from(hash(requestId, code), 'hex'),
            Buffer.from(row.code_hash, 'hex'),
          )
        )
          return { status: 401, error: 'Recovery code is invalid or expired.' }
        const consumed = await auth.db
          .prepare(
            'UPDATE password_resets SET used=1 WHERE id=? AND used=0 AND attempts<=5 AND expires_at>?',
          )
          .run(requestId, now())
        if (!consumed.changes || !(await auth.resetPassword(row.user_id, password)))
          return { status: 401, error: 'Recovery code is invalid or expired.' }
        await auth.event(null, ip, 'recovery_completed')
        return { status: 200, reset: true }
      })
    },
  }
}
export function emailJsDelivery(env = process.env) {
  if (!env.EMAILJS_SERVICE_ID || !env.EMAILJS_OTP_TEMPLATE_ID || !env.EMAILJS_PUBLIC_KEY)
    return null
  return async (email, name, code) => {
    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        service_id: env.EMAILJS_SERVICE_ID,
        template_id: env.EMAILJS_OTP_TEMPLATE_ID,
        user_id: env.EMAILJS_PUBLIC_KEY,
        ...(env.EMAILJS_PRIVATE_KEY ? { accessToken: env.EMAILJS_PRIVATE_KEY } : {}),
        template_params: { to_email: email, to_name: name, otp_code: code },
      }),
    })
    if (!response.ok) throw Error('Recovery delivery failed')
  }
}
