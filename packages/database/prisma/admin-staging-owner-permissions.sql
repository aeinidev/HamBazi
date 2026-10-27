-- Explicit Staging-only operator prerequisite; never loaded by ordinary migration grants.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM admin_realms WHERE id <> 'staging') THEN
    RAISE EXCEPTION 'Staging owner profile required';
  END IF;
END; $$;
-- Reuse the existing host-gateway-only private recovery role for identity backup.
GRANT SELECT ON admin_sessions, admin_grants TO hambazi_admin_recovery;
GRANT SELECT ON admin_roles, admin_operator_roles, admin_operations TO hambazi_admin_recovery;
COMMIT;
