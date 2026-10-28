> Current verification: service and keys are configured privately in the existing backend environment. The non-sending staff and OTP configuration checks pass. Exactly one approved test email was accepted by EmailJS and confirmed received with correct content by the user. This confirms delivery, not the complete new-staff login/password-change acceptance. Physical IoT work is deferred.

# Staff email — existing temporary-password template

Use the existing `template_0yrgzoz` for staff account emails and keep
`template_ka70fq4` for OTP recovery. No new provider template, subscription or
activation-link configuration is required. Earlier activation-link instructions
are superseded by the user's explicit temporary-password requirement.

Only Administrators create staff accounts. The server generates a random
temporary password, stores only its salted hash, and sends the existing fields:
`to_email`, `to_name`, `role`, `temporary_password`, `login_url`.
The staff member signs in with it and must choose a different password before
protected RBAC access. Staff cannot self-register through activation links.

The existing ignored `plant-conservation-backend/.env` selects `EMAILJS_TEMPLATE_ID=template_0yrgzoz`; the authentication server loads it privately.
Existing public service/key configuration is reused. Keep both EmailJS templates
unchanged. `EMAILJS_ACTIVATION_TEMPLATE_ID` is unused.

From workspace root run:

```bash
npm --prefix web run check:staff-email
```

Expected `staffEmail.ready: true`, empty missing/invalid arrays,
`websiteOriginReady: true`, `deliveryTest: NOT SENT`.
`check:activation` remains a historical alias to this non-sending command.

Only after explicit email-test approval: Administrator → User Management →
Create staff account → Create account and email temporary password, using an
approved unused test inbox. Verify receipt, temporary-password login, mandatory
Set New Password, protected API denial before change, old password/session
rejection afterward and correct role access after re-login. No real email has
been sent by these changes; automated tests use injected delivery only.

Resend temporary-password email rotates credentials only for staff awaiting their
first change, or converts a legacy Pending Activation account on explicit admin
action. Completed/disabled accounts cannot be reset this way. Failed delivery
retains mandatory-change restrictions; retry through the admin resend action.
Existing account/token rows are preserved. Old activation endpoint returns 410
and the historical page offers sign-in guidance only. Public OTP recovery cannot
bypass new staff's first temporary-password login; existing permanent-password
users retain recovery. Visitor registration and RBAC grants remain unchanged.

Never log, return in an API response or share the temporary password, session
secret or private EmailJS key. Real email delivery still requires approval.
