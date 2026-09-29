-- Run as the migration owner after deploy. No PUBLIC or blanket future-table grants.
BEGIN;
GRANT SELECT, INSERT ON sessions TO hambazi_api;
GRANT UPDATE (revoked_at) ON sessions TO hambazi_api;
GRANT SELECT, INSERT, DELETE ON bot_update_receipts, bot_onboarding_flows TO hambazi_api;
GRANT UPDATE (phase, version, lease_until, reply, flow_id, prompt_version) ON bot_update_receipts TO hambazi_api;
GRANT UPDATE (version, state, prompt_version, prompt_message_id, admitted_receipt_id) ON bot_onboarding_flows TO hambazi_api;
-- Cleanup only: no sender, update, prompt, workflow or session metadata reads/writes.
GRANT SELECT (id, expires_at), DELETE ON bot_update_receipts, bot_onboarding_flows TO hambazi_worker;
GRANT SELECT, INSERT, UPDATE ON users, user_settings TO hambazi_api;
GRANT SELECT, INSERT, DELETE ON profile_mutation_receipts TO hambazi_api;
GRANT SELECT (id, expires_at), DELETE ON profile_mutation_receipts TO hambazi_worker;
GRANT SELECT ON games TO hambazi_api, hambazi_worker;
GRANT SELECT, INSERT ON room_command_receipts TO hambazi_api;
GRANT SELECT, INSERT, UPDATE ON rooms TO hambazi_api;
GRANT SELECT, UPDATE ON rooms TO hambazi_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON room_members TO hambazi_api;
GRANT SELECT, INSERT, UPDATE ON matches, match_players TO hambazi_api, hambazi_worker;
GRANT SELECT, INSERT ON game_events, processed_commands, game_results TO hambazi_api, hambazi_worker;
GRANT SELECT, INSERT ON outbox_events TO hambazi_api;
GRANT SELECT, INSERT ON outbox_events TO hambazi_worker;
GRANT UPDATE (status, attempts, next_attempt_at, published_at, claimed_until) ON outbox_events TO hambazi_worker;
GRANT SELECT, INSERT ON consumer_receipts TO hambazi_worker;
GRANT SELECT ON user_game_stats TO hambazi_api;
GRANT SELECT, INSERT, UPDATE ON user_game_stats TO hambazi_worker;
GRANT SELECT, INSERT ON chat_messages TO hambazi_api;
GRANT SELECT, INSERT ON match_admissions, match_reservations TO hambazi_api;
GRANT UPDATE (status, active_key, generation, reservation_id, reservation_until, match_id) ON match_admissions TO hambazi_api;
GRANT UPDATE (released_at, match_id) ON match_reservations TO hambazi_api;
GRANT SELECT, INSERT ON match_connection_leases TO hambazi_api;
GRANT UPDATE (lease_until, closed_at) ON match_connection_leases TO hambazi_api;
-- Worker may inspect/expire leases through Matches; it cannot create or renew a connection.
GRANT SELECT ON match_connection_leases TO hambazi_worker;
COMMIT;
