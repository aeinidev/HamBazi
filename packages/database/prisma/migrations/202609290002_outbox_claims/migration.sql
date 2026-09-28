BEGIN;
ALTER TABLE outbox_events ADD COLUMN claimed_until timestamptz(3);
ALTER TABLE outbox_events ADD CONSTRAINT outbox_claim_status CHECK
  (claimed_until IS NULL OR status = 'PENDING');
COMMIT;
