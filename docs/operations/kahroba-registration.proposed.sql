-- REVIEW ONLY: no K4A staging execution is authorized.
-- This is dormant catalog DML against the existing schema, not a migration.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('kahroba-registration-v1'));
INSERT INTO games (
  id, slug, title, min_players, max_players, status,
  config_schema_version, config_jsonb, matchmaking_enabled,
  private_rooms_enabled, chat_enabled, voice_enabled, updated_at
) VALUES (
  'kahroba', 'kahroba', 'کهربا', 2, 4, 'DISABLED',
  1, '{}'::jsonb, false, false, false, false, CURRENT_TIMESTAMP
) ON CONFLICT (id) DO NOTHING;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM games WHERE id = 'kahroba' AND slug = 'kahroba'
      AND title = 'کهربا' AND min_players = 2 AND max_players = 4
      AND status = 'DISABLED' AND config_schema_version = 1
      AND config_jsonb = '{}'::jsonb AND NOT matchmaking_enabled
      AND NOT private_rooms_enabled AND NOT chat_enabled AND NOT voice_enabled
  ) THEN
    RAISE EXCEPTION 'KAHROBA_REGISTRATION_MISMATCH';
  END IF;
END $$;
COMMIT;
