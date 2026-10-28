CREATE TABLE user_restrictions (
 id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 realm_id TEXT NOT NULL, actor_id UUID NOT NULL, reason_code TEXT NOT NULL,
 duration TEXT NOT NULL CHECK (duration IN ('HOUR_1','HOURS_24','DAYS_7','DAYS_30','PERMANENT')),
 created_at TIMESTAMPTZ(3) NOT NULL, expires_at TIMESTAMPTZ(3),
 ended_at TIMESTAMPTZ(3), end_kind TEXT, ended_by_operation_id UUID,
 CHECK (reason_code IN ('ABUSE','SPAM','SECURITY','INCIDENT_RESPONSE','APPEAL')),
 CHECK ((duration='PERMANENT') = (expires_at IS NULL)),
 CHECK (expires_at IS NULL OR expires_at = created_at + CASE duration WHEN 'HOUR_1' THEN interval '1 hour' WHEN 'HOURS_24' THEN interval '24 hours' WHEN 'DAYS_7' THEN interval '168 hours' WHEN 'DAYS_30' THEN interval '720 hours' END),
 CHECK ((ended_at IS NULL AND end_kind IS NULL AND ended_by_operation_id IS NULL) OR
        (ended_at IS NOT NULL AND end_kind IS NOT NULL AND ended_at >= created_at AND ((end_kind='EXPIRED' AND ended_by_operation_id IS NULL AND expires_at IS NOT NULL AND ended_at>=expires_at) OR (end_kind='REVOKED' AND ended_by_operation_id IS NOT NULL))))
);
CREATE UNIQUE INDEX user_restrictions_active_idx ON user_restrictions(user_id) WHERE ended_at IS NULL;
CREATE INDEX user_restrictions_user_id_id_idx ON user_restrictions(user_id,id);
CREATE INDEX user_restrictions_ended_at_expires_at_idx ON user_restrictions(ended_at,expires_at);
-- Restriction evidence may only transition once to a terminal state.
CREATE FUNCTION protect_user_restriction() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP <> 'UPDATE' THEN RAISE EXCEPTION 'RESTRICTION_IMMUTABLE'; END IF;
 IF OLD.ended_at IS NOT NULL OR NEW.ended_at IS NULL OR
    (to_jsonb(OLD)-ARRAY['ended_at','end_kind','ended_by_operation_id']) <> (to_jsonb(NEW)-ARRAY['ended_at','end_kind','ended_by_operation_id']) THEN
   RAISE EXCEPTION 'RESTRICTION_IMMUTABLE';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER user_restriction_immutable BEFORE UPDATE OR DELETE ON user_restrictions FOR EACH ROW EXECUTE FUNCTION protect_user_restriction();
