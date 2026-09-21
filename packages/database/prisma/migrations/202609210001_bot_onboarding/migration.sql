BEGIN;
CREATE TABLE bot_update_receipts (
  id UUID PRIMARY KEY,
  bot_id BIGINT NOT NULL CHECK (bot_id > 0),
  update_id INTEGER NOT NULL CHECK (update_id >= 0),
  telegram_user_id BIGINT NOT NULL CHECK (telegram_user_id > 0),
  message_id INTEGER NOT NULL CHECK (message_id > 0),
  reply_to_message_id INTEGER CHECK (reply_to_message_id > 0),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  action TEXT NOT NULL CHECK (action IN ('START','CREATE','CANCEL','NAME')),
  phase TEXT NOT NULL CHECK (phase IN ('PROCESSING','CREATING','REPLY','DONE')),
  version INTEGER NOT NULL CHECK (version > 0),
  received_at TIMESTAMPTZ(3) NOT NULL,
  expires_at TIMESTAMPTZ(3) NOT NULL,
  lease_until TIMESTAMPTZ(3) NOT NULL,
  reply TEXT CHECK (reply IN ('CREATE_ACCOUNT','PROMPT_NAME','INVALID_NAME','MENU','CANCELLED','EXPIRED','DENIED')),
  flow_id UUID,
  prompt_version INTEGER CHECK (prompt_version > 0),
  CONSTRAINT bot_receipt_lifetime CHECK (expires_at = received_at + interval '168 hours'),
  CONSTRAINT bot_receipt_lease CHECK (lease_until <= expires_at),
  CONSTRAINT bot_receipt_reply CHECK ((phase IN ('REPLY','DONE')) = (reply IS NOT NULL)),
  CONSTRAINT bot_receipt_prompt CHECK ((reply IN ('PROMPT_NAME','INVALID_NAME')) IS NOT TRUE OR (flow_id IS NOT NULL AND prompt_version IS NOT NULL)),
  CONSTRAINT bot_receipt_name CHECK ((action = 'NAME') = (reply_to_message_id IS NOT NULL)),
  CONSTRAINT bot_receipt_creation CHECK (phase <> 'CREATING' OR (action = 'NAME' AND flow_id IS NOT NULL))
);
CREATE UNIQUE INDEX bot_update_receipts_bot_id_update_id_key ON bot_update_receipts(bot_id, update_id);
CREATE INDEX bot_update_receipts_expires_at_idx ON bot_update_receipts(expires_at);

CREATE TABLE bot_onboarding_flows (
  id UUID PRIMARY KEY,
  bot_id BIGINT NOT NULL CHECK (bot_id > 0),
  telegram_user_id BIGINT NOT NULL CHECK (telegram_user_id > 0),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  version INTEGER NOT NULL CHECK (version > 0),
  state TEXT NOT NULL CHECK (state IN ('WAITING','SUBMITTING')),
  created_at TIMESTAMPTZ(3) NOT NULL,
  expires_at TIMESTAMPTZ(3) NOT NULL,
  prompt_version INTEGER NOT NULL CHECK (prompt_version > 0),
  prompt_message_id INTEGER CHECK (prompt_message_id > 0),
  admitted_receipt_id UUID,
  CONSTRAINT bot_flow_lifetime CHECK (expires_at = created_at + interval '15 minutes'),
  CONSTRAINT bot_flow_submission CHECK ((state = 'SUBMITTING') = (admitted_receipt_id IS NOT NULL))
);
CREATE UNIQUE INDEX bot_onboarding_flows_bot_id_telegram_user_id_key ON bot_onboarding_flows(bot_id, telegram_user_id);
CREATE INDEX bot_onboarding_flows_expires_at_idx ON bot_onboarding_flows(expires_at);

-- Identity/retention are immutable even to accidental owner-level updates.
CREATE FUNCTION guard_bot_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id,NEW.bot_id,NEW.update_id,NEW.telegram_user_id,NEW.message_id,NEW.reply_to_message_id,NEW.schema_version,NEW.action,NEW.received_at,NEW.expires_at)
     IS DISTINCT FROM ROW(OLD.id,OLD.bot_id,OLD.update_id,OLD.telegram_user_id,OLD.message_id,OLD.reply_to_message_id,OLD.schema_version,OLD.action,OLD.received_at,OLD.expires_at)
     OR NEW.version < OLD.version OR NEW.version > OLD.version + 1
     OR (NEW.lease_until IS DISTINCT FROM OLD.lease_until AND NEW.version <> OLD.version + 1)
     OR (OLD.phase = 'REPLY' AND NEW.phase NOT IN ('REPLY','DONE'))
     OR (OLD.phase = 'CREATING' AND NEW.phase NOT IN ('CREATING','REPLY'))
     OR (OLD.phase = 'DONE' AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'Invalid onboarding receipt transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bot_receipt_guard BEFORE UPDATE ON bot_update_receipts FOR EACH ROW EXECUTE FUNCTION guard_bot_receipt();
CREATE FUNCTION guard_bot_flow() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id,NEW.bot_id,NEW.telegram_user_id,NEW.schema_version,NEW.created_at,NEW.expires_at)
     IS DISTINCT FROM ROW(OLD.id,OLD.bot_id,OLD.telegram_user_id,OLD.schema_version,OLD.created_at,OLD.expires_at)
     OR NEW.version <> OLD.version + 1 OR NEW.prompt_version < OLD.prompt_version
     OR (OLD.state = 'SUBMITTING' AND NEW.state = 'SUBMITTING' AND NEW.admitted_receipt_id IS DISTINCT FROM OLD.admitted_receipt_id) THEN
    RAISE EXCEPTION 'Invalid onboarding flow transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bot_flow_guard BEFORE UPDATE ON bot_onboarding_flows FOR EACH ROW EXECUTE FUNCTION guard_bot_flow();
REVOKE ALL ON FUNCTION guard_bot_receipt(), guard_bot_flow() FROM PUBLIC;
COMMIT;
