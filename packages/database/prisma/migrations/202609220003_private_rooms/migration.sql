BEGIN;
ALTER TABLE rooms ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN state_version INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN started_match_id UUID;
ALTER TABLE rooms ADD CONSTRAINT rooms_schema_version CHECK (schema_version > 0),
  ADD CONSTRAINT rooms_state_version CHECK (state_version >= 0);
CREATE UNIQUE INDEX rooms_started_match_id_key ON rooms(started_match_id);
ALTER TABLE room_members ADD COLUMN joined_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE room_members ADD CONSTRAINT room_members_joined_version CHECK (joined_version >= 0);
CREATE TABLE room_command_receipts (
  actor_user_id UUID NOT NULL,
  command_id UUID NOT NULL,
  room_id UUID NOT NULL,
  request_digest CHAR(64) NOT NULL,
  applied_version INTEGER NOT NULL CHECK (applied_version >= 0),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT room_command_receipts_pkey PRIMARY KEY (actor_user_id, command_id),
  CONSTRAINT room_command_receipts_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX room_command_receipts_room_id_idx ON room_command_receipts(room_id);
COMMIT;
