-- Expand only; grants and activation require a separate approved deployment.
ALTER TABLE admin_operations ADD COLUMN private_note_ciphertext TEXT;
ALTER TABLE admin_operations ADD CONSTRAINT admin_private_note_size CHECK (private_note_ciphertext IS NULL OR octet_length(private_note_ciphertext) <= 12000);
ALTER TABLE admin_audit_events DROP CONSTRAINT admin_audit_events_event_check;
ALTER TABLE admin_audit_events ADD CONSTRAINT admin_audit_events_event_check CHECK (event IN (
 'OWNER_BOOTSTRAPPED','OWNER_RECOVERED','LOGIN_DENIED','PASSWORD_VERIFIED','LOGIN_SUCCEEDED','PIN_DENIED','OWNER_LOCKED','PIN_CHANGED','PASSWORD_CHANGED','REAUTH_DENIED','REAUTH_SUCCEEDED','LOGOUT',
 'AUTHORIZATION_DENIED','OPERATION_REQUESTED','OPERATION_RENEWED','OPERATION_APPROVED','OPERATION_ADMITTED','OPERATION_SUCCEEDED','OPERATION_FAILED','PRIVATE_NOTE_VIEWED')) NOT VALID;
ALTER TABLE admin_audit_events VALIDATE CONSTRAINT admin_audit_events_event_check;
