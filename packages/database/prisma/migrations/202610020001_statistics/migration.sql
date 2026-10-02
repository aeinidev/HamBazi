BEGIN;
CREATE TABLE match_results (
  match_id UUID PRIMARY KEY, event_id UUID NOT NULL, ordinal BIGSERIAL NOT NULL,
  payload_jsonb JSONB NOT NULL CHECK (jsonb_typeof(payload_jsonb) = 'object'),
  CONSTRAINT match_results_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX match_results_event_id_key ON match_results(event_id);
CREATE UNIQUE INDEX match_results_ordinal_key ON match_results(ordinal);
CREATE TRIGGER match_results_immutable BEFORE UPDATE OR DELETE ON match_results FOR EACH ROW EXECUTE FUNCTION hambazi_reject_history_mutation();
CREATE TRIGGER match_results_no_truncate BEFORE TRUNCATE ON match_results FOR EACH STATEMENT EXECUTE FUNCTION hambazi_reject_history_mutation();
CREATE TRIGGER game_results_immutable BEFORE UPDATE OR DELETE ON game_results FOR EACH ROW EXECUTE FUNCTION hambazi_reject_history_mutation();
CREATE TRIGGER game_results_no_truncate BEFORE TRUNCATE ON game_results FOR EACH STATEMENT EXECUTE FUNCTION hambazi_reject_history_mutation();
CREATE TABLE stats_generations (
 id UUID PRIMARY KEY, status TEXT NOT NULL CHECK (status IN ('ACTIVE','BUILDING','RETIRED','FAILED')),
 created_at TIMESTAMPTZ(3) NOT NULL
);
CREATE TABLE stats_heads (
 id TEXT PRIMARY KEY CHECK (id = 'statistics-v1'), active_id UUID NOT NULL, building_id UUID,
 CONSTRAINT stats_heads_active_id_fkey FOREIGN KEY (active_id) REFERENCES stats_generations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT stats_heads_building_id_fkey FOREIGN KEY (building_id) REFERENCES stats_generations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CHECK (building_id IS NULL OR building_id <> active_id)
);
CREATE TABLE stats_applications (
 generation_id UUID NOT NULL, match_id UUID NOT NULL, digest CHAR(64) NOT NULL,
 PRIMARY KEY (generation_id, match_id),
 CONSTRAINT stats_applications_generation_id_fkey FOREIGN KEY (generation_id) REFERENCES stats_generations(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE stats_values (
 generation_id UUID NOT NULL, user_id UUID NOT NULL, game_id TEXT NOT NULL,
 metric TEXT NOT NULL CHECK (metric IN ('completed','wins')), period TEXT NOT NULL,
 value BIGINT NOT NULL CHECK (value >= 0),
 PRIMARY KEY (generation_id, user_id, game_id, metric, period),
 CONSTRAINT stats_values_generation_id_fkey FOREIGN KEY (generation_id) REFERENCES stats_generations(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX stats_values_generation_id_game_id_metric_period_value_user_idx ON stats_values(generation_id,game_id,metric,period,value,user_id);
INSERT INTO stats_generations VALUES ('00000000-0000-4000-8000-000000000001','ACTIVE',CURRENT_TIMESTAMP);
INSERT INTO stats_heads VALUES ('statistics-v1','00000000-0000-4000-8000-000000000001',NULL);
COMMIT;
