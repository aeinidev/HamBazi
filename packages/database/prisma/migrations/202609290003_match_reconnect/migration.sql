BEGIN;
ALTER TABLE matches ADD COLUMN reconnect_policy_jsonb JSONB;
ALTER TABLE match_players ADD COLUMN disconnect_deadline_at TIMESTAMPTZ(3);
CREATE TABLE match_connection_leases (
  match_id UUID NOT NULL,
  connection_id UUID NOT NULL,
  user_id UUID NOT NULL,
  session_expires_at TIMESTAMPTZ(3) NOT NULL,
  lease_until TIMESTAMPTZ(3) NOT NULL,
  closed_at TIMESTAMPTZ(3),
  CONSTRAINT match_connection_leases_pkey PRIMARY KEY (match_id, connection_id),
  CONSTRAINT match_connection_leases_match_id_user_id_fkey FOREIGN KEY (match_id, user_id)
    REFERENCES match_players(match_id, user_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT match_connection_leases_expiry CHECK (lease_until <= session_expires_at)
);
CREATE INDEX match_connection_leases_match_id_user_id_lease_until_idx
  ON match_connection_leases(match_id, user_id, lease_until);
CREATE FUNCTION guard_match_connection_lease() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.match_id, NEW.connection_id, NEW.user_id, NEW.session_expires_at)
     IS DISTINCT FROM (OLD.match_id, OLD.connection_id, OLD.user_id, OLD.session_expires_at)
     OR (OLD.closed_at IS NOT NULL AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'immutable connection identity or closed lease';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER match_connection_leases_guard BEFORE UPDATE ON match_connection_leases
  FOR EACH ROW EXECUTE FUNCTION guard_match_connection_lease();
CREATE FUNCTION guard_match_reconnect_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.reconnect_policy_jsonb IS NOT NULL
    AND NEW.reconnect_policy_jsonb IS DISTINCT FROM OLD.reconnect_policy_jsonb THEN
    RAISE EXCEPTION 'reconnect policy pinned';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER matches_guard_reconnect_policy BEFORE UPDATE ON matches
  FOR EACH ROW EXECUTE FUNCTION guard_match_reconnect_policy();
REVOKE ALL ON FUNCTION guard_match_connection_lease(), guard_match_reconnect_policy() FROM PUBLIC;
COMMIT;
