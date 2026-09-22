-- ADR-018: disabled metadata only. Existing operator/data state must never be overwritten.
INSERT INTO games (id, slug, title, min_players, max_players,
  matchmaking_enabled, private_rooms_enabled, chat_enabled, voice_enabled,
  status, config_schema_version, config_jsonb, created_at, updated_at)
VALUES ('coup', 'coup', 'Coup', 2, 6, false, false, false, false,
  'DISABLED', 1, '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
