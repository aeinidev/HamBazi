BEGIN;
ALTER TABLE chat_messages ADD COLUMN command_id uuid, ADD COLUMN seq integer;
CREATE UNIQUE INDEX chat_messages_match_id_user_id_command_id_key ON chat_messages(match_id, user_id, command_id);
CREATE UNIQUE INDEX chat_messages_match_id_seq_key ON chat_messages(match_id, seq);
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_v1_metadata CHECK (
  (command_id IS NULL AND seq IS NULL) OR (command_id IS NOT NULL AND seq IS NOT NULL AND seq > 0)
);
CREATE TABLE chat_streams (
  match_id uuid PRIMARY KEY REFERENCES matches(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  last_seq integer NOT NULL DEFAULT 0 CHECK (last_seq >= 0)
);
COMMIT;
