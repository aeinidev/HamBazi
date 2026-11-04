-- Local preparation only; live activation requires separately approved deployment.
BEGIN;
-- Retain the dedicated reader's existing 2s statement timeout and no table-wide grants.
GRANT SELECT (slug,min_players,max_players,matchmaking_enabled,private_rooms_enabled,chat_enabled,voice_enabled,config_schema_version) ON games TO hambazi_admin_reader;
GRANT SELECT (capacity,host_user_id,created_at,updated_at,expires_at,started_match_id) ON rooms TO hambazi_admin_reader;
GRANT SELECT (room_id,match_type,last_event_seq,created_at,updated_at) ON matches TO hambazi_admin_reader;
GRANT SELECT (room_id,user_id,seat,joined_at) ON room_members TO hambazi_admin_reader;
GRANT SELECT (seat,joined_at,agent_type,connection_epoch,ready_at,disconnected_at,disconnect_deadline_at,replaced_at) ON match_players TO hambazi_admin_reader;
GRANT SELECT (match_id,actor_id,seat) ON match_bot_seats TO hambazi_admin_reader;
GRANT SELECT (match_id,seq,schema_version,actor_user_id,created_at) ON game_events TO hambazi_admin_reader;
-- Existing GameResult user/placement/winner grants suffice; never grant metrics.
-- No config, invite, engine state, reconnect policy, event payload or write permission.
COMMIT;
