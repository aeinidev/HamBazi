BEGIN;
CREATE TABLE sessions (
  id UUID NOT NULL,
  user_id UUID NOT NULL,
  command_id UUID NOT NULL,
  schema_version INTEGER NOT NULL,
  key_id TEXT NOT NULL,
  issuer TEXT NOT NULL,
  audience TEXT NOT NULL,
  issued_at TIMESTAMPTZ(3) NOT NULL,
  expires_at TIMESTAMPTZ(3) NOT NULL,
  revoked_at TIMESTAMPTZ(3),
  CONSTRAINT sessions_pkey PRIMARY KEY (id),
  CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT sessions_schema_version_check CHECK (schema_version > 0),
  CONSTRAINT sessions_key_id_check CHECK (key_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  CONSTRAINT sessions_context_check CHECK (length(issuer) BETWEEN 1 AND 256 AND length(audience) BETWEEN 1 AND 256),
  CONSTRAINT sessions_time_check CHECK (
    isfinite(issued_at) AND isfinite(expires_at) AND issued_at >= '1970-01-01T00:00:00Z' AND
    expires_at > issued_at AND date_trunc('second', issued_at) = issued_at AND
    date_trunc('second', expires_at) = expires_at AND
    (revoked_at IS NULL OR (isfinite(revoked_at) AND revoked_at >= issued_at))
  )
);
CREATE UNIQUE INDEX sessions_user_id_command_id_key ON sessions(user_id, command_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

-- Runtime grants are column-limited too. Once revoked, a session cannot be revived.
CREATE FUNCTION guard_session_metadata() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id OR
     NEW.command_id IS DISTINCT FROM OLD.command_id OR NEW.schema_version IS DISTINCT FROM OLD.schema_version OR
     NEW.key_id IS DISTINCT FROM OLD.key_id OR NEW.issuer IS DISTINCT FROM OLD.issuer OR
     NEW.audience IS DISTINCT FROM OLD.audience OR NEW.issued_at IS DISTINCT FROM OLD.issued_at OR
     NEW.expires_at IS DISTINCT FROM OLD.expires_at OR
     (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'Session metadata is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sessions_guard_metadata BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION guard_session_metadata();
COMMIT;
