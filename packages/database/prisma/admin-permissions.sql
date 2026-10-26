-- Private provisioning prerequisite: these roles must be created independently with distinct secrets.
-- Not applied by the regular API/Worker migration grant workflow; no existing role is broadened.
BEGIN;
GRANT USAGE ON SCHEMA public TO hambazi_admin_runtime, hambazi_admin_bootstrap, hambazi_admin_recovery;
GRANT SELECT ON admin_realms, admin_operators, admin_sessions, admin_auth_receipts, admin_grants, admin_audit_events TO hambazi_admin_runtime;
GRANT INSERT ON admin_sessions, admin_auth_receipts, admin_audit_events TO hambazi_admin_runtime;
GRANT UPDATE (pin_failures, locked_at, session_epoch, pin_verifier, password_verifier, credential_version) ON admin_operators TO hambazi_admin_runtime;
GRANT UPDATE (last_seen_at, revoked_at) ON admin_sessions TO hambazi_admin_runtime;
GRANT SELECT ON admin_realms, admin_operators, admin_auth_receipts, admin_audit_events TO hambazi_admin_bootstrap;
GRANT INSERT ON admin_realms, admin_operators, admin_audit_events, admin_auth_receipts TO hambazi_admin_bootstrap;
GRANT UPDATE (owner_id, ownership_epoch) ON admin_realms TO hambazi_admin_bootstrap;
GRANT SELECT ON admin_realms, admin_operators, admin_auth_receipts, admin_audit_events TO hambazi_admin_recovery;
GRANT INSERT ON admin_audit_events, admin_auth_receipts TO hambazi_admin_recovery;
GRANT UPDATE (pin_verifier, pin_failures, locked_at, credential_version, session_epoch) ON admin_operators TO hambazi_admin_recovery;
GRANT UPDATE (ownership_epoch) ON admin_realms TO hambazi_admin_recovery;
-- Metadata only: column grants prevent accidental full-model reads and hidden-state access.
GRANT USAGE ON SCHEMA public TO hambazi_admin_reader;
GRANT SELECT (id, display_name, status) ON users TO hambazi_admin_reader;
GRANT SELECT (id, title, status) ON games TO hambazi_admin_reader;
GRANT SELECT (id, game_id, status, state_version) ON rooms TO hambazi_admin_reader;
GRANT SELECT (id, game_id, status, state_version, started_at, engine_version, state_schema_version, ruleset_version) ON matches TO hambazi_admin_reader;
GRANT SELECT (match_id, connection_status) ON match_players TO hambazi_admin_reader;
GRANT SELECT (id, type) ON game_events TO hambazi_admin_reader;
GRANT SELECT (id, status, created_at) ON outbox_events TO hambazi_admin_reader;
COMMIT;
