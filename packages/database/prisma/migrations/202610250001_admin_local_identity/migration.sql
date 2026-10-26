BEGIN;
CREATE TABLE admin_realms (
 id TEXT PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9-]{0,63}$'),
 owner_id UUID UNIQUE,
 ownership_epoch INTEGER NOT NULL DEFAULT 0 CHECK (ownership_epoch >= 0),
 policy_revision INTEGER NOT NULL DEFAULT 1 CHECK (policy_revision > 0)
);
CREATE TABLE admin_operators (
 id UUID PRIMARY KEY,
 realm_id TEXT NOT NULL REFERENCES admin_realms(id) ON DELETE RESTRICT,
 username TEXT NOT NULL CHECK (username ~ '^[a-z0-9][a-z0-9_.-]{2,63}$'),
 password_verifier TEXT NOT NULL CHECK (password_verifier LIKE '$argon2id$%'),
 pin_verifier TEXT CHECK (pin_verifier LIKE '$argon2id$%'),
 credential_version INTEGER NOT NULL CHECK (credential_version > 0),
 session_epoch INTEGER NOT NULL CHECK (session_epoch > 0),
 authorization_version INTEGER NOT NULL CHECK (authorization_version > 0),
 status TEXT NOT NULL CHECK (status IN ('ACTIVE','DISABLED','DELETED')),
 pin_failures INTEGER NOT NULL DEFAULT 0 CHECK (pin_failures BETWEEN 0 AND 3),
 locked_at TIMESTAMPTZ(3),
 UNIQUE(realm_id, username),
 CHECK ((locked_at IS NOT NULL) = (pin_failures = 3))
);
ALTER TABLE admin_realms ADD CONSTRAINT admin_root_fk FOREIGN KEY (owner_id) REFERENCES admin_operators(id) ON DELETE RESTRICT;
CREATE TABLE admin_sessions (
 id UUID PRIMARY KEY,
 realm_id TEXT NOT NULL REFERENCES admin_realms(id) ON DELETE RESTRICT,
 operator_id UUID NOT NULL REFERENCES admin_operators(id) ON DELETE RESTRICT,
 kind TEXT NOT NULL CHECK (kind IN ('PENDING','FULL')),
 credential_version INTEGER NOT NULL CHECK (credential_version > 0),
 session_epoch INTEGER NOT NULL CHECK (session_epoch > 0),
 issued_at TIMESTAMPTZ(3) NOT NULL, expires_at TIMESTAMPTZ(3) NOT NULL,
 last_seen_at TIMESTAMPTZ(3) NOT NULL, revoked_at TIMESTAMPTZ(3),
 CHECK (expires_at > issued_at AND last_seen_at >= issued_at)
);
CREATE INDEX admin_sessions_operator_id_expires_at_idx ON admin_sessions(operator_id, expires_at);
CREATE TABLE admin_auth_receipts (
 operator_id UUID NOT NULL REFERENCES admin_operators(id) ON DELETE RESTRICT,
 command_id UUID NOT NULL, digest CHAR(64) NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
 outcome TEXT NOT NULL, session_id UUID REFERENCES admin_sessions(id) ON DELETE RESTRICT,
 PRIMARY KEY(operator_id, command_id)
);
CREATE TABLE admin_grants (
 id UUID PRIMARY KEY, realm_id TEXT NOT NULL REFERENCES admin_realms(id) ON DELETE RESTRICT,
 operator_id UUID NOT NULL REFERENCES admin_operators(id) ON DELETE RESTRICT,
 permission TEXT NOT NULL, environment TEXT NOT NULL,
 all_games BOOLEAN NOT NULL DEFAULT false, game_ids TEXT[] NOT NULL,
 deny BOOLEAN NOT NULL DEFAULT false,
 CHECK (cardinality(game_ids) <= 100)
);
CREATE INDEX admin_grants_operator_id_realm_id_idx ON admin_grants(operator_id, realm_id);
CREATE TABLE admin_audit_events (
 id UUID PRIMARY KEY, realm_id TEXT NOT NULL REFERENCES admin_realms(id) ON DELETE RESTRICT,
 operator_id UUID, command_id UUID NOT NULL,
 event TEXT NOT NULL CHECK (event IN ('OWNER_BOOTSTRAPPED','OWNER_RECOVERED','LOGIN_DENIED',
 'PASSWORD_VERIFIED','LOGIN_SUCCEEDED','PIN_DENIED','OWNER_LOCKED','PIN_CHANGED','REAUTH_DENIED','LOGOUT')),
 occurred_at TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX admin_audit_events_realm_id_occurred_at_id_idx ON admin_audit_events(realm_id,occurred_at,id);
CREATE FUNCTION admin_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable administrative evidence' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER admin_audit_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON admin_audit_events
 FOR EACH STATEMENT EXECUTE FUNCTION admin_append_only();
CREATE TRIGGER admin_receipts_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON admin_auth_receipts
 FOR EACH STATEMENT EXECUTE FUNCTION admin_append_only();
CREATE FUNCTION admin_root_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' OR (OLD.owner_id IS NOT NULL AND NEW.owner_id IS DISTINCT FROM OLD.owner_id) THEN
   RAISE EXCEPTION 'Protected owner binding' USING ERRCODE='23514';
 END IF;
 IF NEW.owner_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM admin_operators WHERE id=NEW.owner_id AND realm_id=NEW.id AND pin_verifier IS NOT NULL AND status='ACTIVE') THEN
   RAISE EXCEPTION 'Invalid owner binding' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER admin_root_protected BEFORE UPDATE OR DELETE ON admin_realms FOR EACH ROW EXECUTE FUNCTION admin_root_guard();
CREATE FUNCTION admin_operator_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM admin_realms WHERE owner_id=OLD.id) THEN
   IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Protected owner' USING ERRCODE='23514'; END IF;
   IF NEW.id IS DISTINCT FROM OLD.id OR NEW.realm_id IS DISTINCT FROM OLD.realm_id OR NEW.username IS DISTINCT FROM OLD.username OR NEW.status <> 'ACTIVE' THEN
     RAISE EXCEPTION 'Protected owner' USING ERRCODE='23514';
   END IF;
 END IF;
 IF TG_OP = 'UPDATE' AND OLD.locked_at IS NOT NULL AND
    (NEW.locked_at IS NULL OR NEW.pin_failures < 3) AND current_user <> 'hambazi_admin_recovery' THEN
   RAISE EXCEPTION 'Private recovery required' USING ERRCODE='23514';
 END IF;
 IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER admin_operator_protected BEFORE UPDATE OR DELETE ON admin_operators FOR EACH ROW EXECUTE FUNCTION admin_operator_guard();
CREATE FUNCTION admin_session_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id <> OLD.id OR NEW.operator_id <> OLD.operator_id OR NEW.realm_id <> OLD.realm_id OR
 NEW.kind <> OLD.kind OR NEW.session_epoch <> OLD.session_epoch OR NEW.credential_version <> OLD.credential_version OR
 NEW.issued_at <> OLD.issued_at OR NEW.expires_at <> OLD.expires_at OR NEW.last_seen_at < OLD.last_seen_at OR
 (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
 RAISE EXCEPTION 'Immutable session metadata' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER admin_session_metadata BEFORE UPDATE ON admin_sessions FOR EACH ROW EXECUTE FUNCTION admin_session_guard();
COMMIT;
