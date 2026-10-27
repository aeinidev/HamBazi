-- Additive product revisions and module-owned outcome outboxes. No player data rewrite.
BEGIN;
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "auth_version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "auth_version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "games" ADD COLUMN     "admin_availability" TEXT NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "admin_version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "user_admin_effects" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "realm_id" TEXT NOT NULL,
    "digest" CHAR(64) NOT NULL,
    "target_id" TEXT NOT NULL,
    "result_code" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_admin_effects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_admin_effects" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "realm_id" TEXT NOT NULL,
    "digest" CHAR(64) NOT NULL,
    "target_id" TEXT NOT NULL,
    "result_code" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "game_admin_effects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_admin_effects" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "realm_id" TEXT NOT NULL,
    "digest" CHAR(64) NOT NULL,
    "target_id" TEXT NOT NULL,
    "result_code" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "room_admin_effects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_admin_effects" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "realm_id" TEXT NOT NULL,
    "digest" CHAR(64) NOT NULL,
    "target_id" TEXT NOT NULL,
    "result_code" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "match_admin_effects_pkey" PRIMARY KEY ("id")
);

ALTER TABLE users ADD CONSTRAINT users_auth_version_check CHECK (auth_version >= 0);
ALTER TABLE sessions ADD CONSTRAINT sessions_auth_version_check CHECK (auth_version >= 0);
ALTER TABLE games ADD CONSTRAINT games_admin_gate_check CHECK (admin_version >= 0 AND admin_availability IN ('ACTIVE','MAINTENANCE','DISABLED'));
CREATE TRIGGER user_admin_effects_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON user_admin_effects FOR EACH STATEMENT EXECUTE FUNCTION admin_append_only();
CREATE TRIGGER game_admin_effects_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON game_admin_effects FOR EACH STATEMENT EXECUTE FUNCTION admin_append_only();
CREATE TRIGGER room_admin_effects_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON room_admin_effects FOR EACH STATEMENT EXECUTE FUNCTION admin_append_only();
CREATE TRIGGER match_admin_effects_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON match_admin_effects FOR EACH STATEMENT EXECUTE FUNCTION admin_append_only();
COMMIT;
