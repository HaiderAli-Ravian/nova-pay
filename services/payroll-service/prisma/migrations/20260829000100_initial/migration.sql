CREATE TYPE "PayrollIdempotencyState" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE "PayrollJobStatus" AS ENUM ('PENDING', 'QUEUED', 'PROCESSING', 'COMPLETED', 'PARTIALLY_FAILED', 'FAILED');
CREATE TYPE "PayrollItemStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

CREATE TABLE "payroll_jobs" (
  "id" UUID NOT NULL,
  "employer_id" VARCHAR(100) NOT NULL,
  "source_wallet_id" UUID NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "status" "PayrollJobStatus" NOT NULL DEFAULT 'PENDING',
  "total_items" INTEGER NOT NULL,
  "completed_items" INTEGER NOT NULL DEFAULT 0,
  "failed_items" INTEGER NOT NULL DEFAULT 0,
  "total_amount" NUMERIC(28,8) NOT NULL,
  "bullmq_job_id" VARCHAR(160),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_jobs_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "payroll_jobs_total_amount_check" CHECK ("total_amount" > 0),
  CONSTRAINT "payroll_jobs_counts_check" CHECK (
    "total_items" > 0
    AND "completed_items" >= 0
    AND "failed_items" >= 0
    AND "completed_items" + "failed_items" <= "total_items"
  )
);

CREATE TABLE "payroll_idempotency_records" (
  "id" UUID NOT NULL,
  "employer_id" VARCHAR(100) NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "job_id" UUID NOT NULL,
  "state" "PayrollIdempotencyState" NOT NULL DEFAULT 'PROCESSING',
  "response_status" SMALLINT,
  "response_body" JSONB,
  "replay_expires_at" TIMESTAMPTZ(6) NOT NULL,
  "retention_until" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_idempotency_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_idempotency_records_hash_check" CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "payroll_idempotency_records_expiry_check" CHECK ("retention_until" >= "replay_expires_at"),
  CONSTRAINT "payroll_idempotency_records_response_status_check" CHECK ("response_status" IS NULL OR "response_status" BETWEEN 100 AND 599),
  CONSTRAINT "payroll_idempotency_records_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "payroll_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "payroll_items" (
  "id" UUID NOT NULL,
  "payroll_job_id" UUID NOT NULL,
  "external_item_id" VARCHAR(128) NOT NULL,
  "recipient_wallet_id" UUID NOT NULL,
  "amount" NUMERIC(28,8) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "status" "PayrollItemStatus" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "processing_token" UUID,
  "processing_started_at" TIMESTAMPTZ(6),
  "transfer_id" UUID,
  "transfer_idempotency_key" VARCHAR(128) NOT NULL,
  "failure_code" VARCHAR(80),
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_items_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "payroll_items_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "payroll_items_attempt_count_check" CHECK ("attempt_count" >= 0),
  CONSTRAINT "payroll_items_processing_check" CHECK (("processing_token" IS NULL) = ("processing_started_at" IS NULL)),
  CONSTRAINT "payroll_items_job_id_fkey" FOREIGN KEY ("payroll_job_id") REFERENCES "payroll_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "payroll_idempotency_records_employer_key_key" ON "payroll_idempotency_records"("employer_id", "idempotency_key");
CREATE UNIQUE INDEX "payroll_idempotency_records_job_id_key" ON "payroll_idempotency_records"("job_id");
CREATE INDEX "payroll_idempotency_records_state_updated_at_idx" ON "payroll_idempotency_records"("state", "updated_at");
CREATE INDEX "payroll_idempotency_records_retention_until_idx" ON "payroll_idempotency_records"("retention_until");
CREATE UNIQUE INDEX "payroll_jobs_bullmq_job_id_key" ON "payroll_jobs"("bullmq_job_id") WHERE "bullmq_job_id" IS NOT NULL;
CREATE INDEX "payroll_jobs_employer_created_at_idx" ON "payroll_jobs"("employer_id", "created_at" DESC);
CREATE INDEX "payroll_jobs_status_updated_at_idx" ON "payroll_jobs"("status", "updated_at");
CREATE UNIQUE INDEX "payroll_items_job_external_item_key" ON "payroll_items"("payroll_job_id", "external_item_id");
CREATE UNIQUE INDEX "payroll_items_transfer_id_key" ON "payroll_items"("transfer_id") WHERE "transfer_id" IS NOT NULL;
CREATE UNIQUE INDEX "payroll_items_transfer_idempotency_key_key" ON "payroll_items"("transfer_idempotency_key");
CREATE INDEX "payroll_items_job_status_id_idx" ON "payroll_items"("payroll_job_id", "status", "id");
CREATE INDEX "payroll_items_status_processing_started_at_idx" ON "payroll_items"("status", "processing_started_at");
