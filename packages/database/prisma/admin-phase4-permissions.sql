-- Local preparation only; live activation requires separately approved deployment.
BEGIN;
-- Retain the dedicated reader's existing 2s statement timeout and no table-wide grants.
GRANT SELECT (slug,min_players,max_players,matchmaking_enabled,private_rooms_enabled,chat_enabled,voice_enabled,config_schema_version) ON games TO hambazi_admin_reader;
GRANT SELECT (capacity,host_user_id,created_at,updated_at,expires_at,started_match_id) ON rooms TO hambazi_admin_reader;
GRANT SELECT (room_id,match_type,last_event_seq,created_at,updated_at) ON matches TO hambazi_admin_reader;
-- No config, invite, engine state, reconnect policy, event payload or write permission.
COMMIT;
