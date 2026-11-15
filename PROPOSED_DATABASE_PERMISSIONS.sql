-- REVIEW ONLY — NOT EXECUTED.
-- This file contains proposed least-privilege GRANT examples only.
-- It is deliberately NOT READY TO EXECUTE: replace each quoted placeholder
-- with an existing, approved LOGIN role after reviewing exact role names,
-- schemas, ownership, RLS, and the complete service privilege inventory.
-- Do not create roles or passwords from this file. Do not grant these rights
-- to anon, authenticated, service_role, or the shared postgres role.
-- Grant statements do not bypass RLS. In particular, plant_app visitor scan
-- history currently has RLS enabled and no policies in migration 010.
-- The Plant API statements below cover QR-related operations only, not every
-- privilege required by the full plant backend.

-- Plant API: QR inventory and associated plant/visitor scan operations.
GRANT USAGE ON SCHEMA plant_app TO "<APPROVED_PLANT_API_RUNTIME_ROLE>";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE plant_app.qr_code
  TO "<APPROVED_PLANT_API_RUNTIME_ROLE>";
GRANT USAGE ON SEQUENCE plant_app.qr_code_qr_id_seq
  TO "<APPROVED_PLANT_API_RUNTIME_ROLE>";
GRANT SELECT, INSERT, UPDATE ON TABLE plant_app.plant_record
  TO "<APPROVED_PLANT_API_RUNTIME_ROLE>";
GRANT SELECT, INSERT ON TABLE plant_app.visitor_scan_history
  TO "<APPROVED_PLANT_API_RUNTIME_ROLE>";
GRANT USAGE ON SEQUENCE plant_app.visitor_scan_history_scan_id_seq
  TO "<APPROVED_PLANT_API_RUNTIME_ROLE>";

-- Account/auth API: isolated private schema. Review each table against the
-- deployed auth code before applying; this list reflects the repository's
-- current PostgreSQL schema and auth operations.
GRANT USAGE ON SCHEMA plant_auth TO "<APPROVED_AUTH_API_RUNTIME_ROLE>";
GRANT SELECT ON TABLE plant_auth.schema_migrations
  TO "<APPROVED_AUTH_API_RUNTIME_ROLE>";
GRANT SELECT, INSERT, UPDATE ON TABLE plant_auth.users, plant_auth.visitors
  TO "<APPROVED_AUTH_API_RUNTIME_ROLE>";
GRANT SELECT, INSERT, DELETE ON TABLE plant_auth.sessions, plant_auth.visitor_sessions
  TO "<APPROVED_AUTH_API_RUNTIME_ROLE>";
GRANT SELECT, INSERT ON TABLE plant_auth.auth_events
  TO "<APPROVED_AUTH_API_RUNTIME_ROLE>";
GRANT SELECT, INSERT, DELETE ON TABLE plant_auth.face_service_nonces
  TO "<APPROVED_AUTH_API_RUNTIME_ROLE>";
GRANT SELECT, INSERT, UPDATE ON TABLE plant_auth.password_resets,
  plant_auth.activation_tokens
  TO "<APPROVED_AUTH_API_RUNTIME_ROLE>";
GRANT SELECT, UPDATE ON TABLE plant_auth.security_settings
  TO "<APPROVED_AUTH_API_RUNTIME_ROLE>";
GRANT INSERT, DELETE ON TABLE plant_auth.account_emails
  TO "<APPROVED_AUTH_API_RUNTIME_ROLE>";
GRANT USAGE ON SEQUENCE plant_auth.auth_events_id_seq
  TO "<APPROVED_AUTH_API_RUNTIME_ROLE>";

-- Face API: private biometric schema. Review all query paths and backup
-- retention controls before granting access to biometric templates.
GRANT USAGE ON SCHEMA plant_face TO "<APPROVED_FACE_API_RUNTIME_ROLE>";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  plant_face.accounts,
  plant_face.sessions,
  plant_face.challenges,
  plant_face.real_face_templates,
  plant_face.face_account_links,
  plant_face.legacy_face_replacements
  TO "<APPROVED_FACE_API_RUNTIME_ROLE>";

-- If and only if a prior privilege inventory confirms an unnecessary grant on
-- a specific relation, prepare a separately reviewed revoke using its exact
-- schema/table and role names. No target relation is guessed here:
-- REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE
--   "<CONFIRMED_SCHEMA>"."<CONFIRMED_RELATION>"
--   FROM anon, authenticated, service_role;

-- Do not add DEFAULT PRIVILEGES, RLS changes, schema exposure, table ownership,
-- CREATE, or BYPASSRLS here without a separate reviewed design and test.
