# Private phone HTTPS setup ? current Windows host

Status: **PENDING ? APPROVAL AND DEVICE SETUP REQUIRED**. Historical Codespaces/VPN success is not acceptance for this Windows host. No VPN installation, enrollment, Serve/Funnel change or public exposure was performed in this stage.

## Concrete proposed design for approval

Phone and backend Windows host join the owner's approved private Tailscale network. Private Tailscale Serve HTTPS forwards to a Caddy listener bound only to 127.0.0.1:8080. Caddy forwards plant requests to Node 3000 and authoritative account requests to Node 3001. Do not enable Funnel or publish development ports. Obtain the actual Windows host tailnet name and replace the historical Codespaces hostname in the EXISTING Caddy configuration before activation.

| Route | Existing upstream | Status |
| --- | --- | --- |
| /health and plant /api/* | Node plant API, loopback 3000 | Local service health verified; no phone proof |
| /auth-health | Node account /health, loopback 3001 | Local service health verified |
| /api/auth/* and /api/admin/* | Node account API, loopback 3001 | Cookie/origin/RBAC checks retained |
| /api/mobile/* | Node account API, loopback 3001 | Shared password, bearer sessions and recovery; isolated tests pass |
| /face/* | Historical recognizer port 8000 | BLOCKED: no working recognition service verified |
| /internal/*, /face/internal/*, private files | Blocked | Keep gateway deny rules |

The source template now routes /api/mobile/* to the correct account service. This source edit does not activate the gateway. Existing IoT handlers and routes were not changed.

## Approved setup sequence (do not execute before approval)

1. Confirm the private network owner, approved Windows host, phone and actual hostname. Approve installation/enrollment on those devices.
2. Install and authenticate the approved VPN on host and phone. Keep both in the same authorized private network; apply an appropriate private access policy.
3. Review the existing deploy/private-phone.Caddyfile with the actual hostname. Keep bind 127.0.0.1 and private-file/internal-route denies. Run configuration validation before starting it hidden as a host service.
4. Configure private Serve HTTPS to the loopback gateway only. Record actual commands and verified hostname after installation; never infer them from the old Codespaces example.
5. Configure the existing private mobile environment using approved URLs: EXPO_PUBLIC_API_URL=https://ACTUAL-APPROVED-HOST and EXPO_PUBLIC_AUTH_API_URL=https://ACTUAL-APPROVED-HOST/api/mobile. These are placeholders in documentation, not configured values. Keep recognizer configuration separate; do not pretend /face is operational.
6. Set the approved website origin for server cookie/origin checks. Rebuild/restart the native app to embed public URL settings. No secrets belong in Expo public variables.
7. From the actual phone, verify certificate trust, /health, /auth-health, unauthenticated rejection and approved-account native login. Verify authenticated plant API requests, independent website/mobile logout and no cross-account draft access. Record safe status/record IDs, never tokens or passwords.
8. Continue camera/GPS/encrypted draft expiry/restart/synchronization acceptance only after connectivity succeeds.

Production hosting/HTTPS configuration and deployment are separate approvals. Physical IoT remains **PENDING ? REQUIRES USER APPROVAL**. No Python command is part of the active Vue/Node/PostgreSQL setup.
