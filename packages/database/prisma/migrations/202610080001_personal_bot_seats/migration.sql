BEGIN;
CREATE TABLE match_bot_seats (
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  actor_id UUID NOT NULL,
  seat INTEGER NOT NULL CHECK (seat BETWEEN 1 AND 5),
  PRIMARY KEY (match_id, actor_id),
  UNIQUE (match_id, seat)
);
REVOKE ALL ON match_bot_seats FROM PUBLIC;
COMMIT;
