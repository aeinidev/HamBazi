-- Expand only. Activation requires separately approved phase-two grants and coordinated Auth rollout.
BEGIN;
-- AlterTable
ALTER TABLE "admin_audit_events" ADD COLUMN     "mode" TEXT,
ADD COLUMN     "operation" TEXT,
ADD COLUMN     "reason_code" TEXT,
ADD COLUMN     "target_id" TEXT;

-- CreateTable
CREATE TABLE "admin_roles" (
    "id" UUID NOT NULL,
    "realm_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "grants_jsonb" JSONB NOT NULL,

    CONSTRAINT "admin_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_operator_roles" (
    "operator_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "realm_id" TEXT NOT NULL,

    CONSTRAINT "admin_operator_roles_pkey" PRIMARY KEY ("operator_id","role_id")
);

-- CreateTable
CREATE TABLE "admin_operations" (
    "id" UUID NOT NULL,
    "realm_id" TEXT NOT NULL,
    "actor_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "authorization_version" INTEGER NOT NULL,
    "credential_version" INTEGER NOT NULL,
    "session_epoch" INTEGER NOT NULL,
    "policy_revision" INTEGER NOT NULL,
    "ownership_epoch" INTEGER NOT NULL,
    "environment" TEXT NOT NULL,
    "digest" CHAR(64) NOT NULL,
    "action" JSONB NOT NULL,
    "game_id" TEXT,
    "reason_code" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "mode" TEXT,
    "approver_id" UUID,
    "approver_session_id" UUID,
    "approver_authorization_version" INTEGER,
    "approver_session_epoch" INTEGER,
    "approver_credential_version" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "approved_until" TIMESTAMPTZ(3),
    "result_code" TEXT,

    CONSTRAINT "admin_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_roles_realm_id_name_key" ON "admin_roles"("realm_id", "name");

-- CreateIndex
CREATE INDEX "admin_operations_realm_id_state_created_at_idx" ON "admin_operations"("realm_id", "state", "created_at");

-- CreateIndex
CREATE INDEX "admin_operations_realm_id_actor_id_created_at_idx" ON "admin_operations"("realm_id", "actor_id", "created_at");

ALTER TABLE admin_roles ADD CONSTRAINT admin_roles_realm_fk FOREIGN KEY (realm_id) REFERENCES admin_realms(id) ON DELETE RESTRICT;
ALTER TABLE admin_roles ADD CONSTRAINT admin_roles_shape CHECK (version > 0 AND length(name) BETWEEN 2 AND 64 AND jsonb_typeof(grants_jsonb)='array' AND jsonb_array_length(grants_jsonb)<=128);
CREATE UNIQUE INDEX admin_roles_id_realm_key ON admin_roles(id, realm_id);
CREATE UNIQUE INDEX admin_operators_id_realm_key ON admin_operators(id, realm_id);
ALTER TABLE admin_operator_roles ADD CONSTRAINT admin_membership_operator_fk FOREIGN KEY(operator_id,realm_id) REFERENCES admin_operators(id,realm_id) ON DELETE RESTRICT;
ALTER TABLE admin_operator_roles ADD CONSTRAINT admin_membership_role_fk FOREIGN KEY(role_id,realm_id) REFERENCES admin_roles(id,realm_id) ON DELETE RESTRICT;
ALTER TABLE admin_operations ADD CONSTRAINT admin_operations_actor_fk FOREIGN KEY(actor_id,realm_id) REFERENCES admin_operators(id,realm_id) ON DELETE RESTRICT;
ALTER TABLE admin_operations ADD CONSTRAINT admin_operations_state_check CHECK (state IN ('PENDING','APPROVED','UNKNOWN','SUCCEEDED','FAILED') AND (mode IS NULL OR mode IN ('OWNER_FINAL','DUAL_CONTROL')) AND expires_at > created_at AND authorization_version>0 AND policy_revision>0);
ALTER TABLE admin_operations ADD CONSTRAINT admin_operations_action_check CHECK (jsonb_typeof(action)='object' AND octet_length(action::text)<=8192 AND NOT action ?| ARRAY['password','pin','passwordVerifier','pinVerifier']);
ALTER TABLE admin_audit_events DROP CONSTRAINT admin_audit_events_event_check;
ALTER TABLE admin_audit_events ADD CONSTRAINT admin_audit_events_event_check CHECK (event IN (
 'OWNER_BOOTSTRAPPED','OWNER_RECOVERED','LOGIN_DENIED','PASSWORD_VERIFIED','LOGIN_SUCCEEDED','PIN_DENIED','OWNER_LOCKED','PIN_CHANGED','PASSWORD_CHANGED','REAUTH_DENIED','REAUTH_SUCCEEDED','LOGOUT',
 'AUTHORIZATION_DENIED','OPERATION_REQUESTED','OPERATION_RENEWED','OPERATION_APPROVED','OPERATION_ADMITTED','OPERATION_SUCCEEDED','OPERATION_FAILED')) NOT VALID;
ALTER TABLE admin_audit_events VALIDATE CONSTRAINT admin_audit_events_event_check;
CREATE INDEX admin_audit_actor_idx ON admin_audit_events(realm_id,operator_id,occurred_at,id);
CREATE INDEX admin_audit_target_idx ON admin_audit_events(realm_id,target_id,occurred_at,id);
CREATE FUNCTION admin_runtime_no_root_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_user='hambazi_admin_runtime' AND NEW.pin_verifier IS NOT NULL THEN
   RAISE EXCEPTION 'Runtime cannot create an owner identity' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER admin_runtime_identity_guard BEFORE INSERT ON admin_operators FOR EACH ROW EXECUTE FUNCTION admin_runtime_no_root_insert();
COMMIT;
