# EmailJS backend authorization diagnosis

Run `npm run check:staff-email` from `web`. It sends no email and prints only
presence flags, paths, sources, and a sender source revision (never key values).
This command checks a fresh process, not an already running server.

The authentication server loads `plant-conservation-backend/.env`, then
`web/.env.server` overrides it. Existing process environment variables win over
both files. `web/.env` is not loaded by this server. Missing public settings may
fall back to `mobileapp/.env.local`; the staff template may fall back to
`web/.env.local`. Private keys never come from public/mobile fallbacks.

After changing configuration, restart the authentication backend using your normal
launcher (`npm run server` from `web` for the standalone server). Compare the
`staff_email_runtime` startup record with the fresh checker: senderRevision,
paths, key presence, and sources. The record includes PID and load time. Existing
process variables can retain stale values even after files are edited; update
those variables in the launcher when applicable. Do not paste key values into
logs, screenshots, tickets, or chat.

The REST payload uses service_id, template_id, user_id (public key), and optional
accessToken (private key). Private authentication is optional in the API but may
be required by the account's security policy. Ensure all identifiers and keys
belong to the intended EmailJS account. Do not disable security checks to work
around a bad key.

In EmailJS Account > Security, verify that non-browser API requests are enabled
and check whether private-key authorization is required. The account settings
cannot be inferred from a generic authorization message.

On the next administrator-authorized delivery attempt, backend stderr records
`staff_email_provider_failure` with the exact status, category, and an allowlisted
provider response phrase. Unrecognized response text is withheld because EmailJS
may echo secrets or template fields. No automatic retry or test email is sent.
The existing database audit also retains `staff_email_http_<status>` events.
Provider success confirms API acceptance; it does not prove inbox delivery.

Official references:
- https://www.emailjs.com/docs/rest-api/send/
- https://github.com/emailjs-com/emailjs-nodejs
