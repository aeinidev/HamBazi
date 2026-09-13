BEGIN;

-- The provisioned public schema is a prerequisite. Do not request CREATE on the
-- database merely to issue CREATE SCHEMA IF NOT EXISTS for an existing schema.

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "telegram_user_id" BIGINT NOT NULL,
    "display_name" TEXT NOT NULL,
    "public_handle" TEXT NOT NULL,
    "telegram_username" TEXT,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_settings" (
    "user_id" UUID NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "settings_jsonb" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "games" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "min_players" INTEGER NOT NULL,
    "max_players" INTEGER NOT NULL,
    "matchmaking_enabled" BOOLEAN NOT NULL,
    "private_rooms_enabled" BOOLEAN NOT NULL,
    "chat_enabled" BOOLEAN NOT NULL,
    "voice_enabled" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "config_schema_version" INTEGER NOT NULL,
    "config_jsonb" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" UUID NOT NULL,
    "game_id" TEXT NOT NULL,
    "host_user_id" UUID NOT NULL,
    "capacity" INTEGER NOT NULL,
    "invite_code" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_members" (
    "room_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "seat" INTEGER NOT NULL,
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_members_pkey" PRIMARY KEY ("room_id","user_id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" UUID NOT NULL,
    "game_id" TEXT NOT NULL,
    "room_id" UUID,
    "match_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "engine_version" TEXT NOT NULL,
    "state_schema_version" INTEGER NOT NULL,
    "ruleset_version" TEXT NOT NULL,
    "state_jsonb" JSONB,
    "state_version" INTEGER NOT NULL DEFAULT 0,
    "last_event_seq" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_players" (
    "match_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "seat" INTEGER NOT NULL,
    "agent_type" TEXT NOT NULL,
    "connection_status" TEXT NOT NULL,
    "connection_epoch" INTEGER NOT NULL DEFAULT 0,
    "disconnected_at" TIMESTAMPTZ(3),
    "replaced_at" TIMESTAMPTZ(3),
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_players_pkey" PRIMARY KEY ("match_id","user_id")
);

-- CreateTable
CREATE TABLE "game_events" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "actor_user_id" UUID,
    "payload_jsonb" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_commands" (
    "match_id" UUID NOT NULL,
    "action_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "expected_version" INTEGER NOT NULL,
    "resulting_version" INTEGER NOT NULL,
    "result_jsonb" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_commands_pkey" PRIMARY KEY ("match_id","action_id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "payload_jsonb" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(3),
    "request_id" TEXT,
    "traceparent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consumer_receipts" (
    "consumer" TEXT NOT NULL,
    "event_id" UUID NOT NULL,
    "processed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consumer_receipts_pkey" PRIMARY KEY ("consumer","event_id")
);

-- CreateTable
CREATE TABLE "game_results" (
    "match_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "game_id" TEXT NOT NULL,
    "placement" INTEGER NOT NULL,
    "winner" BOOLEAN NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "metrics_jsonb" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_results_pkey" PRIMARY KEY ("match_id","user_id")
);

-- CreateTable
CREATE TABLE "user_game_stats" (
    "user_id" UUID NOT NULL,
    "game_id" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "value" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_game_stats_pkey" PRIMARY KEY ("user_id","game_id","metric","period")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_telegram_user_id_key" ON "users"("telegram_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_public_handle_key" ON "users"("public_handle");

-- CreateIndex
CREATE UNIQUE INDEX "games_slug_key" ON "games"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_invite_code_key" ON "rooms"("invite_code");

-- CreateIndex
CREATE INDEX "rooms_status_expires_at_idx" ON "rooms"("status", "expires_at");

-- CreateIndex
CREATE INDEX "room_members_user_id_idx" ON "room_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "room_members_room_id_seat_key" ON "room_members"("room_id", "seat");

-- CreateIndex
CREATE UNIQUE INDEX "matches_room_id_key" ON "matches"("room_id");

-- CreateIndex
CREATE INDEX "matches_game_id_status_created_at_idx" ON "matches"("game_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "matches_id_game_id_key" ON "matches"("id", "game_id");

-- CreateIndex
CREATE INDEX "match_players_user_id_match_id_idx" ON "match_players"("user_id", "match_id");

-- CreateIndex
CREATE UNIQUE INDEX "match_players_match_id_seat_key" ON "match_players"("match_id", "seat");

-- CreateIndex
CREATE UNIQUE INDEX "game_events_match_id_seq_key" ON "game_events"("match_id", "seq");

-- CreateIndex
CREATE INDEX "outbox_events_status_next_attempt_at_created_at_idx" ON "outbox_events"("status", "next_attempt_at", "created_at");

-- CreateIndex
CREATE INDEX "game_results_user_id_game_id_created_at_idx" ON "game_results"("user_id", "game_id", "created_at");

-- CreateIndex
CREATE INDEX "user_game_stats_game_id_metric_period_value_idx" ON "user_game_stats"("game_id", "metric", "period", "value");

-- CreateIndex
CREATE INDEX "chat_messages_match_id_created_at_id_idx" ON "chat_messages"("match_id", "created_at", "id");

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_host_user_id_fkey" FOREIGN KEY ("host_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_members" ADD CONSTRAINT "room_members_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_members" ADD CONSTRAINT "room_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_events" ADD CONSTRAINT "game_events_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_events" ADD CONSTRAINT "game_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processed_commands" ADD CONSTRAINT "processed_commands_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processed_commands" ADD CONSTRAINT "processed_commands_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_results" ADD CONSTRAINT "game_results_match_id_game_id_fkey" FOREIGN KEY ("match_id", "game_id") REFERENCES "matches"("id", "game_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_results" ADD CONSTRAINT "game_results_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_results" ADD CONSTRAINT "game_results_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_game_stats" ADD CONSTRAINT "user_game_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_game_stats" ADD CONSTRAINT "user_game_stats_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PostgreSQL invariants not expressible in the Prisma schema. Keep on future diffs.
ALTER TABLE user_settings ADD CONSTRAINT user_settings_schema_positive CHECK (schema_version > 0);
ALTER TABLE games ADD CONSTRAINT games_bounds CHECK (min_players > 0 AND max_players >= min_players),
  ADD CONSTRAINT games_status CHECK (status IN ('ACTIVE', 'MAINTENANCE', 'DISABLED')),
  ADD CONSTRAINT games_schema_positive CHECK (config_schema_version > 0);
ALTER TABLE rooms ADD CONSTRAINT rooms_capacity CHECK (capacity > 0),
  ADD CONSTRAINT rooms_status CHECK (status IN ('WAITING', 'FULL', 'STARTING', 'STARTED', 'CLOSED', 'EXPIRED'));
ALTER TABLE room_members ADD CONSTRAINT room_members_seat CHECK (seat >= 0);
ALTER TABLE matches ADD CONSTRAINT matches_versions CHECK (state_version >= 0 AND last_event_seq >= 0 AND state_schema_version > 0 AND length(engine_version) > 0 AND length(ruleset_version) > 0),
  ADD CONSTRAINT matches_status CHECK (status IN ('CREATED', 'WAITING_FOR_PLAYERS', 'READY', 'STARTING', 'ACTIVE', 'FINISHED', 'TERMINATED')),
  ADD CONSTRAINT matches_active_snapshot CHECK (status NOT IN ('ACTIVE', 'FINISHED') OR (state_jsonb IS NOT NULL AND jsonb_typeof(state_jsonb) = 'object'));
ALTER TABLE match_players ADD CONSTRAINT match_players_seat_epoch CHECK (seat >= 0 AND connection_epoch >= 0),
  ADD CONSTRAINT match_players_agent CHECK (agent_type IN ('HUMAN', 'BOT'));
ALTER TABLE game_events ADD CONSTRAINT game_events_versions CHECK (seq > 0 AND schema_version > 0);
ALTER TABLE processed_commands ADD CONSTRAINT processed_commands_versions CHECK (schema_version > 0 AND expected_version >= 0 AND resulting_version >= expected_version);
ALTER TABLE outbox_events ADD CONSTRAINT outbox_versions CHECK (schema_version > 0 AND attempts >= 0),
  ADD CONSTRAINT outbox_status CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED')),
  ADD CONSTRAINT outbox_published CHECK ((status = 'PUBLISHED') = (published_at IS NOT NULL));
ALTER TABLE game_results ADD CONSTRAINT game_results_values CHECK (placement > 0 AND schema_version > 0);
ALTER TABLE chat_messages ADD CONSTRAINT chat_schema_positive CHECK (schema_version > 0);

-- Append-only defenses also protect against accidental owner-level DML. Maintenance
-- that changes these histories requires an explicit reviewed migration/runbook.
CREATE FUNCTION hambazi_reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'APPEND_ONLY_HISTORY';
END;
$$;
CREATE TRIGGER game_events_immutable BEFORE UPDATE OR DELETE ON game_events FOR EACH ROW EXECUTE FUNCTION hambazi_reject_history_mutation();
CREATE TRIGGER game_events_no_truncate BEFORE TRUNCATE ON game_events FOR EACH STATEMENT EXECUTE FUNCTION hambazi_reject_history_mutation();
CREATE TRIGGER processed_commands_immutable BEFORE UPDATE OR DELETE ON processed_commands FOR EACH ROW EXECUTE FUNCTION hambazi_reject_history_mutation();
CREATE TRIGGER processed_commands_no_truncate BEFORE TRUNCATE ON processed_commands FOR EACH STATEMENT EXECUTE FUNCTION hambazi_reject_history_mutation();

CREATE FUNCTION hambazi_guard_match_versions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.engine_version IS DISTINCT FROM OLD.engine_version
    OR NEW.state_schema_version IS DISTINCT FROM OLD.state_schema_version
    OR NEW.ruleset_version IS DISTINCT FROM OLD.ruleset_version THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'MATCH_VERSION_PINNED';
  END IF;
  IF NEW.state_version < OLD.state_version OR NEW.last_event_seq < OLD.last_event_seq
    OR (NEW.state_jsonb IS DISTINCT FROM OLD.state_jsonb AND NEW.state_version <= OLD.state_version) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'MATCH_VERSION_INVALID';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER matches_guard_versions BEFORE UPDATE ON matches FOR EACH ROW EXECUTE FUNCTION hambazi_guard_match_versions();

REVOKE ALL ON FUNCTION hambazi_reject_history_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION hambazi_guard_match_versions() FROM PUBLIC;
COMMIT;
