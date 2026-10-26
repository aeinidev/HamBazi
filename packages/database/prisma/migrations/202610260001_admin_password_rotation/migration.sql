-- Additive event vocabulary; older Admin binaries can continue reading existing event strings.
BEGIN;
ALTER TABLE admin_audit_events DROP CONSTRAINT admin_audit_events_event_check;
ALTER TABLE admin_audit_events ADD CONSTRAINT admin_audit_events_event_check
 CHECK (event IN ('OWNER_BOOTSTRAPPED','OWNER_RECOVERED','LOGIN_DENIED',
 'PASSWORD_VERIFIED','LOGIN_SUCCEEDED','PIN_DENIED','OWNER_LOCKED','PIN_CHANGED',
 'PASSWORD_CHANGED','REAUTH_DENIED','LOGOUT')) NOT VALID;
ALTER TABLE admin_audit_events VALIDATE CONSTRAINT admin_audit_events_event_check;
COMMIT;
