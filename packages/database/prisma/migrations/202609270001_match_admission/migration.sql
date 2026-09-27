BEGIN;
CREATE TABLE match_reservations (
  id UUID PRIMARY KEY,
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  request_digest CHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ(3) NOT NULL,
  released_at TIMESTAMPTZ(3),
  match_id UUID,
  CONSTRAINT match_reservations_disposition CHECK (released_at IS NULL OR match_id IS NULL)
);
CREATE UNIQUE INDEX match_reservations_match_id_key ON match_reservations(match_id);
CREATE TABLE match_admissions (
  id UUID PRIMARY KEY,
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  actor_user_id UUID NOT NULL,
  command_id UUID NOT NULL,
  game_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity BETWEEN 2 AND 64),
  status TEXT NOT NULL CHECK (status IN ('SEARCHING','RESERVED','MATCHED','CANCELLED','EXPIRED')),
  active_key TEXT,
  generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
  created_at TIMESTAMPTZ(3) NOT NULL,
  expires_at TIMESTAMPTZ(3) NOT NULL CHECK (expires_at > created_at),
  reservation_id UUID,
  reservation_until TIMESTAMPTZ(3),
  match_id UUID,
  CONSTRAINT match_admissions_active CHECK ((active_key IS NOT NULL) = (status IN ('SEARCHING','RESERVED'))),
  CONSTRAINT match_admissions_match CHECK ((match_id IS NOT NULL) = (status = 'MATCHED')),
  CONSTRAINT match_admissions_reserved CHECK (status <> 'RESERVED' OR (reservation_id IS NOT NULL AND reservation_until IS NOT NULL)),
  CONSTRAINT match_admissions_deadline CHECK (reservation_until IS NULL OR reservation_until <= expires_at)
);
CREATE UNIQUE INDEX match_admissions_actor_user_id_command_id_key ON match_admissions(actor_user_id,command_id);
CREATE UNIQUE INDEX match_admissions_active_key_key ON match_admissions(active_key);
CREATE INDEX match_admissions_reservation_id_idx ON match_admissions(reservation_id);
ALTER TABLE match_admissions ADD CONSTRAINT match_admissions_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT match_admissions_game_id_fkey FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT match_admissions_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT match_admissions_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES match_reservations(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE match_reservations ADD CONSTRAINT match_reservations_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE RESTRICT ON UPDATE CASCADE;
-- Immutable intent and terminal dispositions prevent late/stale writers reopening tickets.
CREATE FUNCTION guard_match_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.schema_version,NEW.id,NEW.actor_user_id,NEW.command_id,NEW.game_id,NEW.mode,NEW.capacity,NEW.created_at,NEW.expires_at)
     IS DISTINCT FROM ROW(OLD.schema_version,OLD.id,OLD.actor_user_id,OLD.command_id,OLD.game_id,OLD.mode,OLD.capacity,OLD.created_at,OLD.expires_at)
     OR OLD.status IN ('MATCHED','CANCELLED','EXPIRED')
     OR NEW.generation <= OLD.generation THEN
    RAISE EXCEPTION 'Invalid admission transition';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER match_admissions_guard BEFORE UPDATE ON match_admissions FOR EACH ROW EXECUTE FUNCTION guard_match_admission();
CREATE FUNCTION guard_match_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.schema_version,NEW.id,NEW.request_digest,NEW.expires_at) IS DISTINCT FROM ROW(OLD.schema_version,OLD.id,OLD.request_digest,OLD.expires_at)
     OR OLD.released_at IS NOT NULL OR OLD.match_id IS NOT NULL
     OR (NEW.released_at IS NULL AND NEW.match_id IS NULL) THEN
    RAISE EXCEPTION 'Invalid reservation transition';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER match_reservations_guard BEFORE UPDATE ON match_reservations FOR EACH ROW EXECUTE FUNCTION guard_match_reservation();
COMMIT;
