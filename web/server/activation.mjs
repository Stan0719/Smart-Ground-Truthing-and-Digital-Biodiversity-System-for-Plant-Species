// Historical filename/API aliases retained; staff provisioning uses temporary passwords.
import { randomBytes, randomUUID } from 'node:crypto'
import { activationConfiguration } from './activation-configuration.mjs'
import { hashPassword, publicUser, digest } from './auth.mjs'
export function validPassword(password, confirmation) {
  return (
    typeof password === 'string' &&
    password.length >= 8 &&
    password.length <= 128 &&
    password === confirmation
  )
}
export function createStaffInvitations({ auth, deliver, origin, now = () => Date.now() }) {
  return {
    async invite(body, actor, ip, existingId) {
      if (!deliver)
        return {
          status: 503,
          error: 'Staff account email delivery is not configured. No account was created.',
        }
      const { name, username, email, role } = body
      if (
        typeof name !== 'string' ||
        !name.trim() ||
        name.length > 100 ||
        typeof username !== 'string' ||
        !/^[A-Za-z0-9_.-]{3,64}$/.test(username) ||
        typeof email !== 'string' ||
        email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        !['Botanist', 'Conservation Officer'].includes(role)
      )
        return {
          status: 400,
          error: 'Enter name, username (3–64 letters/numbers/._-), email and staff role.',
        }
      const recent = async () =>
        (
          await auth.db
            .prepare(
              "SELECT COUNT(*) AS n FROM auth_events WHERE actor_id=? AND reason='invitation_created' AND created_at>?",
            )
            .get(actor, now() - 15 * 60 * 1000)
        ).n
      if ((await recent()) >= 20)
        return { status: 429, error: 'Too many invitations. Try again after 15 minutes.' }
      const id = existingId || randomUUID(),
        temporaryPassword = 'Niah-' + randomBytes(18).toString('base64url') + '9!'
      const hash = await hashPassword(temporaryPassword)
      let recipient = { name: name.trim(), email: email.trim().toLowerCase(), role }
      const blocked = await auth.db.transaction(async () => {
        await auth.db
          .prepare('SELECT pg_advisory_xact_lock(hashtext(?))')
          .get('staff-invitations:' + actor)

        if ((await recent()) >= 20) {
          return { status: 429, error: 'Too many invitations. Try again after 15 minutes.' }
        }
        if (existingId) {
          const current = await auth.db.prepare('SELECT * FROM users WHERE id=? FOR UPDATE').get(id)
          if (
            !current ||
            !['Botanist', 'Conservation Officer'].includes(current.role) ||
            !(
              current.status === 'Pending Activation' ||
              (current.status === 'Active' && current.must_change_password)
            )
          ) {
            return {
              status: 409,
              error:
                'Only staff awaiting their first password change can receive a new temporary password.',
            }
          }
          recipient = { name: current.name, email: current.email, role: current.role }
          await auth.db
            .prepare(
              "UPDATE users SET password_hash=?,status='Active',must_change_password=1 WHERE id=?",
            )
            .run(hash, id)
          await auth.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id)
        } else {
          await auth.db
            .prepare(
              "INSERT INTO users(id,name,username,email,role,status,password_hash,must_change_password) VALUES(?,?,?,?,?,'Active',?,1)",
            )
            .run(id, recipient.name, username, recipient.email, role, hash)
        }
        // Preserve historical rows while preventing link-based account setup.
        await auth.db.prepare('UPDATE activation_tokens SET used=1 WHERE user_id=?').run(id)
        await auth.db.prepare('INSERT INTO activation_tokens(token_hash,user_id,expires_at,used) VALUES(?,?,?,0)').run(digest(randomBytes(32).toString('hex')),id,now()+60*60*1000)
        await auth.event(id, ip, 'invitation_created', actor)
      })
      if (blocked) return blocked
      try {
        await deliver({ ...recipient, temporaryPassword, loginUrl: new URL('/', origin).href })
        return { status: 201, user: publicUser(await auth.byId(id)), delivery: 'sent' }
      } catch (failure) {
        await auth.event(id, ip, 'staff_email_delivery_failed', actor)
        const diagnostic = deliveryErrors[failure?.deliveryCode]
          ? failure.deliveryCode
          : [
                'EAI_AGAIN',
                'ENOTFOUND',
                'ECONNREFUSED',
                'ECONNRESET',
                'UND_ERR_CONNECT_TIMEOUT',
              ].includes(failure?.cause?.code)
            ? 'network'
            : ['TimeoutError', 'AbortError'].includes(failure?.name)
              ? 'timeout'
              : 'unknown'
        await auth.event(id, ip, `staff_email_failure_${diagnostic}`, actor)
        if (Number.isInteger(failure?.providerStatus))
          await auth.event(id, ip, `staff_email_http_${failure.providerStatus}`, actor)
        return {
          status: 202,
          user: publicUser(await auth.byId(id)),
          delivery: 'failed',
          message:
            'The account requires its temporary password. ' +
            deliveryErrors[diagnostic] +
            ' Delivery was not confirmed.',
        }
      }
    },
    async confirm() {
      return {
        status: 410,
        error:
          'Staff accounts are created by an administrator. Sign in with your temporary password, then change it.',
      }
    },
  }
}
export const createActivation = createStaffInvitations
const deliveryErrors = {
  server_disabled:
    'EmailJS has disabled requests from backend applications. Enable non-browser API requests in EmailJS Account → Security.',
  unauthorized:
    'EmailJS rejected authorization. Check the configured public/private keys and Account → Security settings.',
  configuration:
    'EmailJS rejected the service, template, or template parameters. Check EmailJS Email History for details.',
  limit:
    'EmailJS rejected the request because a rate or quota limit was reached. Check the EmailJS account limits before retrying.',
  mail_service:
    'EmailJS could not use the connected email service. Open Email Services and check or reconnect the Gmail service.',
  network: 'The backend could not connect to EmailJS. Check its DNS and outbound HTTPS connection.',
  timeout: 'The connection to EmailJS timed out. Check backend connectivity before retrying.',
  provider: 'EmailJS is temporarily unavailable. Check its service status before retrying.',
  unknown:
    'The email provider could not confirm delivery. Check EmailJS Email History and the backend connection.',
}
export function temporaryPasswordDelivery(env, fetchImpl = fetch) {
  if (!activationConfiguration(env).ready) return null
  return async ({ email, name, role, temporaryPassword, loginUrl }) => {
    const response = await fetchImpl('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: env.EMAILJS_SERVICE_ID,
        template_id: env.EMAILJS_TEMPLATE_ID,
        user_id: env.EMAILJS_PUBLIC_KEY,
        ...(env.EMAILJS_PRIVATE_KEY ? { accessToken: env.EMAILJS_PRIVATE_KEY } : {}),
        template_params: {
          to_email: email,
          to_name: name,
          role,
          temporary_password: temporaryPassword,
          login_url: loginUrl,
        },
      }),
    })
    if (!response.ok) {
      // Classify only; never return/store provider text, credentials, or template values.
      const text = await response.text().catch(() => '')
      const code = /non.browser|non browser/i.test(text)
        ? 'server_disabled'
        : [402, 429].includes(response.status)
          ? 'limit'
          : [401, 403].includes(response.status)
            ? 'unauthorized'
            : response.status === 412
              ? 'mail_service'
              : [400, 404, 422].includes(response.status)
                ? 'configuration'
                : response.status >= 500
                  ? 'provider'
                  : 'unknown'
      const failure = new Error('Staff account email delivery failed.')
      failure.deliveryCode = code
      failure.providerStatus = response.status
      throw failure
    }
  }
}
export const activationDelivery = temporaryPasswordDelivery
