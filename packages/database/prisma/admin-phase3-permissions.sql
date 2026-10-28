-- Local preparation only. Apply after migration, backup and separately approved deployment.
BEGIN;
-- Bound contains-search cost on the dedicated reader, never on player connections.
DO $$ BEGIN
 EXECUTE format('ALTER ROLE %I IN DATABASE %I SET statement_timeout = %L', 'hambazi_admin_reader', current_database(), '2s');
END $$;
GRANT SELECT, INSERT ON user_restrictions TO hambazi_admin_operations;
GRANT UPDATE (ended_at,end_kind,ended_by_operation_id) ON user_restrictions TO hambazi_admin_operations;
GRANT UPDATE (status,auth_version) ON users TO hambazi_admin_operations;
GRANT SELECT ON user_restrictions TO hambazi_api, hambazi_worker, hambazi_admin_reader;
GRANT UPDATE (ended_at,end_kind,ended_by_operation_id) ON user_restrictions TO hambazi_api, hambazi_worker;
GRANT SELECT (id,status,profile_version,auth_version) ON users TO hambazi_worker;
GRANT UPDATE (status,auth_version,profile_version,updated_at) ON users TO hambazi_api, hambazi_worker;
GRANT SELECT (id,public_handle,created_at,registration_completed_at) ON users TO hambazi_admin_reader;
GRANT SELECT (match_id,user_id) ON match_players TO hambazi_admin_reader;
GRANT SELECT (match_id,user_id,placement,winner) ON game_results TO hambazi_admin_reader;
GRANT SELECT (id,game_id,status,started_at,finished_at) ON matches TO hambazi_admin_reader;
COMMIT;
