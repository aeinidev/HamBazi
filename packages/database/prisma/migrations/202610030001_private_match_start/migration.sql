-- Expand only: old Matches/inserts remain valid; no backfill or policy inference.
ALTER TABLE matches ADD COLUMN room_start_version INTEGER;
ALTER TABLE matches ADD CONSTRAINT matches_room_start_version
  CHECK (room_start_version IS NULL OR
    (room_id IS NOT NULL AND match_type = 'PRIVATE_ROOM' AND room_start_version BETWEEN 1 AND 2147483645));
