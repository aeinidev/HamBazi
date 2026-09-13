-- Run as the migration owner after deploy. No PUBLIC or blanket future-table grants.
BEGIN;
GRANT SELECT, INSERT, UPDATE ON users, user_settings TO hambazi_api;
GRANT SELECT ON games TO hambazi_api, hambazi_worker;
GRANT SELECT, INSERT, UPDATE ON rooms TO hambazi_api;
GRANT SELECT, UPDATE ON rooms TO hambazi_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON room_members TO hambazi_api;
GRANT SELECT, INSERT, UPDATE ON matches, match_players TO hambazi_api, hambazi_worker;
GRANT SELECT, INSERT ON game_events, processed_commands, game_results TO hambazi_api, hambazi_worker;
GRANT SELECT, INSERT ON outbox_events TO hambazi_api;
GRANT SELECT, INSERT ON outbox_events TO hambazi_worker;
GRANT UPDATE (status, attempts, next_attempt_at, published_at) ON outbox_events TO hambazi_worker;
GRANT SELECT, INSERT ON consumer_receipts TO hambazi_worker;
GRANT SELECT ON user_game_stats TO hambazi_api;
GRANT SELECT, INSERT, UPDATE ON user_game_stats TO hambazi_worker;
GRANT SELECT, INSERT ON chat_messages TO hambazi_api;
COMMIT;
