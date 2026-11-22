import { randomUUID } from 'node:crypto'

const validId = /^[A-Za-z0-9_-]{1,200}$/
const actions = new Set([
  'staff_created',
  'staff_deactivated',
  'staff_reactivated',
  'staff_role_changed',
  'staff_profile_updated',
  'staff_archived',
  'security_settings_changed',
])

/** Trusted server-side producer for the existing Migration 013 Admin event contract. */
export function createAdminNotificationProducer({ auth, diagnostic = () => {} }) {
  return {
    async accountEvent({ sourceKey, action, accountName, previousRole, role, status, changedFields = [] }) {
      if (!actions.has(action) || (action !== 'security_settings_changed' && (typeof accountName !== 'string' || !accountName.trim()))) return false
      const safeSource = typeof sourceKey === 'string' && sourceKey.length <= 200 ? sourceKey : null
      if (!safeSource) return false
      const details = {
        action,
        ...(typeof accountName === 'string' && accountName.trim() ? { account_name: accountName.trim().slice(0, 100) } : {}),
        ...(typeof previousRole === 'string' ? { previous_role: previousRole } : {}),
        ...(typeof role === 'string' ? { role } : {}),
        ...(typeof status === 'string' ? { status } : {}),
        ...(Array.isArray(changedFields) && changedFields.length
          ? { changed_fields: [...new Set(changedFields.filter((field) => ['name', 'email', 'role', 'status'].includes(field)))].slice(0, 4) }
          : {}),
      }
      try {
        return await auth.db.transaction(async () => {
          const readiness = await auth.db.prepare(`
            SELECT to_regclass('plant_app.staff_notification_event') IS NOT NULL AS events,
              to_regclass('plant_app.staff_notification') IS NOT NULL AS notifications
          `).get()
          if (!readiness?.events || !readiness?.notifications) return false

          const recipients = (await auth.db.prepare(`
            SELECT id FROM users
            WHERE role='Administrator' AND status='Active' AND must_change_password=0
            ORDER BY id
          `).all()).filter((row) => typeof row.id === 'string' && validId.test(row.id))
          if (!recipients.length) return false

          const eventId = randomUUID()
          const inserted = await auth.db.prepare(`
            INSERT INTO plant_app.staff_notification_event
              (id,source_key,event_type,audience_role,resource_kind,metadata,delivery_state,attempts,delivered_at)
            VALUES(?,?,?, 'Administrator','system',?::jsonb,'delivered',1,clock_timestamp())
            ON CONFLICT(source_key) DO NOTHING
            RETURNING id
          `).get(eventId, safeSource, action === 'security_settings_changed' ? 'security_event' : 'account_administration', JSON.stringify(details))
          if (!inserted) return false

          for (const recipient of recipients) {
            await auth.db.prepare(`
              INSERT INTO plant_app.staff_notification(id,event_id,recipient_subject,intended_role)
              VALUES(?,?,?,'Administrator')
              ON CONFLICT(event_id,recipient_subject,intended_role) DO NOTHING
            `).run(randomUUID(), eventId, `staff:${recipient.id}`)
          }
          return true
        })
      } catch (error) {
        // Notification storage is optional to the account workflow; never log data or SQL details.
        try { diagnostic({ event: 'admin_notification_delivery_unavailable', code: error?.code ?? error?.name ?? 'unknown' }) } catch {}
        return false
      }
    },
  }
}
