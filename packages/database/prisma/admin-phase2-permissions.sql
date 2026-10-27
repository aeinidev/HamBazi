-- Explicit phase-two activation, run by the migration owner only after deployment approval.
-- The operations role must already exist, with separate secret/connection limits and no PUBLIC inheritance.
BEGIN;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname='hambazi_admin_operations') OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='hambazi_admin_operations' AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolbypassrls AND NOT rolreplication) THEN
   RAISE EXCEPTION 'ADMIN_OPERATIONS_ROLE_REQUIRED';
 END IF;
END $$;
GRANT USAGE ON SCHEMA public TO hambazi_admin_operations;
GRANT SELECT, INSERT, UPDATE ON admin_operations, admin_roles TO hambazi_admin_runtime;
GRANT SELECT, INSERT, DELETE ON admin_operator_roles, admin_grants TO hambazi_admin_runtime;
GRANT DELETE ON admin_roles TO hambazi_admin_runtime;
GRANT INSERT ON admin_operators TO hambazi_admin_runtime;
GRANT UPDATE (status, authorization_version) ON admin_operators TO hambazi_admin_runtime;
GRANT UPDATE (policy_revision) ON admin_realms TO hambazi_admin_runtime;
GRANT SELECT (id,status,profile_version,auth_version) ON users TO hambazi_admin_operations;
REVOKE UPDATE (status,auth_version) ON users FROM hambazi_admin_operations;
GRANT UPDATE (display_name,profile_version,updated_at) ON users TO hambazi_admin_operations;
GRANT SELECT (id,admin_version,admin_availability) ON games TO hambazi_admin_operations;
GRANT UPDATE (admin_version,admin_availability,updated_at) ON games TO hambazi_admin_operations;
GRANT SELECT (id,game_id,status,state_version,started_match_id) ON rooms TO hambazi_admin_operations;
GRANT UPDATE (status,state_version,updated_at) ON rooms TO hambazi_admin_operations;
GRANT SELECT (id,game_id,status,state_version,last_event_seq,match_type) ON matches TO hambazi_admin_operations;
GRANT UPDATE (status,state_version,last_event_seq,finished_at,updated_at) ON matches TO hambazi_admin_operations;
GRANT INSERT ON game_events, processed_commands, outbox_events TO hambazi_admin_operations;
GRANT SELECT (id) ON game_events, outbox_events TO hambazi_admin_operations;
GRANT SELECT (match_id) ON processed_commands TO hambazi_admin_operations;
GRANT SELECT, INSERT ON user_admin_effects, game_admin_effects, room_admin_effects, match_admin_effects TO hambazi_admin_operations;
-- USER_STATUS is phase-three work: status/auth_version write grants are deliberately absent.
-- No sessions, player credentials, engine snapshots, cards, chat, results, identity binding or Audit UPDATE grants.
COMMIT;
