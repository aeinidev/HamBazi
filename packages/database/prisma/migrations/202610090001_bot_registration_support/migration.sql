BEGIN;
ALTER TABLE users ADD COLUMN registration_completed_at TIMESTAMPTZ(3);
ALTER TABLE bot_update_receipts ADD COLUMN reply_data JSONB;
-- Additive expansion: keep all old receipts, workflows and public DTO variants.
ALTER TABLE bot_update_receipts DROP CONSTRAINT bot_update_receipts_action_check;
ALTER TABLE bot_update_receipts ADD CONSTRAINT bot_update_receipts_action_check CHECK (action IN ('START','CREATE','CANCEL','NAME','REGISTER','PROFILE','SUPPORT','TEXT','MEDIA','NAVIGATION'));
ALTER TABLE bot_update_receipts DROP CONSTRAINT bot_update_receipts_reply_check;
ALTER TABLE bot_update_receipts ADD CONSTRAINT bot_update_receipts_reply_check CHECK (reply IN ('CREATE_ACCOUNT','PROMPT_NAME','INVALID_NAME','MENU','CANCELLED','EXPIRED','DENIED','WELCOME_REGISTERED','REGISTERED','PROFILE','SUPPORT_PROMPT','SUPPORT_DISPATCH','SUPPORT_SENT','SUPPORT_FAILED','SUPPORT_UNKNOWN','SUPPORT_UNAVAILABLE','SUPPORT_TEXT_REQUIRED','SUPPORT_TOO_LONG','SUPPORT_CANCELLED'));
ALTER TABLE bot_onboarding_flows DROP CONSTRAINT bot_onboarding_flows_state_check;
ALTER TABLE bot_onboarding_flows ADD CONSTRAINT bot_onboarding_flows_state_check CHECK (state IN ('WAITING','SUBMITTING','SUPPORT_COMPOSING'));
ALTER TABLE bot_onboarding_flows DROP CONSTRAINT bot_flow_lifetime;
ALTER TABLE bot_onboarding_flows ADD CONSTRAINT bot_flow_lifetime CHECK ((state IN ('WAITING','SUBMITTING') AND expires_at = created_at + interval '15 minutes') OR (state = 'SUPPORT_COMPOSING' AND expires_at >= created_at + interval '1 minute' AND expires_at <= created_at + interval '15 minutes'));
CREATE TABLE bot_support_submissions (
 id UUID PRIMARY KEY,
 bot_id BIGINT NOT NULL CHECK (bot_id > 0),
 telegram_user_id BIGINT NOT NULL CHECK (telegram_user_id > 0),
 receipt_id UUID NOT NULL UNIQUE,
 profile_id UUID NOT NULL,
 display_name TEXT NOT NULL,
 text TEXT NOT NULL CHECK (char_length(text) BETWEEN 1 AND 3500),
 admin_chat_id BIGINT NOT NULL CHECK (admin_chat_id > 0),
 status TEXT NOT NULL CHECK (status IN ('PENDING','SENDING','DELIVERED','FAILED','UNKNOWN')),
 attempt_version INTEGER NOT NULL DEFAULT 0 CHECK (attempt_version >= 0),
 lease_until TIMESTAMPTZ(3) NOT NULL,
 delivery_message_id INTEGER CHECK (delivery_message_id > 0),
 created_at TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT support_confirmed CHECK ((status = 'DELIVERED') = (delivery_message_id IS NOT NULL))
);
CREATE INDEX bot_support_submissions_bot_id_telegram_user_id_status_idx ON bot_support_submissions(bot_id, telegram_user_id, status);
-- No backfill. Existing profiles retain all data and require an explicit Bot tap.
COMMIT;
