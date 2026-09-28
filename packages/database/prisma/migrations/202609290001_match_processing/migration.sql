BEGIN;
-- Expand only. Existing receipts remain immutable and readable by older releases.
ALTER TABLE match_players ADD COLUMN ready_at timestamptz(3);
ALTER TABLE processed_commands ALTER COLUMN actor_user_id DROP NOT NULL;
ALTER TABLE processed_commands ADD COLUMN request_digest char(64);
ALTER TABLE processed_commands ADD CONSTRAINT processed_commands_digest CHECK
  (request_digest IS NULL OR request_digest ~ '^[0-9a-f]{64}$');
COMMIT;
