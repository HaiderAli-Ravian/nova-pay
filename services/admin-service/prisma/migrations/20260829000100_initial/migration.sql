CREATE TABLE "audit_streams" (
  "stream_key" VARCHAR(160) NOT NULL,
  "last_sequence" BIGINT NOT NULL DEFAULT 0,
  "last_hash" CHAR(64) NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_streams_pkey" PRIMARY KEY ("stream_key"),
  CONSTRAINT "audit_streams_sequence_check" CHECK ("last_sequence" >= 0),
  CONSTRAINT "audit_streams_hash_check" CHECK ("last_hash" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "audit_records" (
  "id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "stream_key" VARCHAR(160) NOT NULL,
  "sequence" BIGINT NOT NULL,
  "action" VARCHAR(100) NOT NULL,
  "entity_type" VARCHAR(80) NOT NULL,
  "entity_id" VARCHAR(128) NOT NULL,
  "actor_id" VARCHAR(128),
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "previous_hash" CHAR(64) NOT NULL,
  "current_hash" CHAR(64) NOT NULL,
  CONSTRAINT "audit_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "audit_records_sequence_check" CHECK ("sequence" > 0),
  CONSTRAINT "audit_records_hashes_check" CHECK ("previous_hash" ~ '^[0-9a-f]{64}$' AND "current_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "audit_records_stream_key_fkey" FOREIGN KEY ("stream_key") REFERENCES "audit_streams"("stream_key") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "audit_records_event_id_key" ON "audit_records"("event_id");
CREATE UNIQUE INDEX "audit_records_stream_sequence_key" ON "audit_records"("stream_key", "sequence");
CREATE UNIQUE INDEX "audit_records_stream_current_hash_key" ON "audit_records"("stream_key", "current_hash");
CREATE INDEX "audit_records_entity_recorded_at_idx" ON "audit_records"("entity_type", "entity_id", "recorded_at" DESC);
CREATE INDEX "audit_records_actor_recorded_at_idx" ON "audit_records"("actor_id", "recorded_at" DESC);
