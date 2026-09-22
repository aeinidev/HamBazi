BEGIN;
ALTER TABLE users ADD COLUMN profile_version INTEGER NOT NULL DEFAULT 0
  CHECK (profile_version >= 0);
CREATE TABLE profile_mutation_receipts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  command_id UUID NOT NULL,
  request_digest TEXT NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  applied_version INTEGER NOT NULL CHECK (applied_version > 0),
  created_at TIMESTAMPTZ(3) NOT NULL,
  expires_at TIMESTAMPTZ(3) NOT NULL CHECK (expires_at = created_at + INTERVAL '168 hours')
);
CREATE UNIQUE INDEX profile_mutation_receipts_user_id_command_id_key
  ON profile_mutation_receipts(user_id, command_id);
CREATE INDEX profile_mutation_receipts_expires_at_idx ON profile_mutation_receipts(expires_at);
COMMIT;
