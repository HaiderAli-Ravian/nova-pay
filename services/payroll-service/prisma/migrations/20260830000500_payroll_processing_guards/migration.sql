ALTER TABLE "payroll_jobs"
  ADD COLUMN "queue_failure_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_queue_error_code" VARCHAR(80);

ALTER TABLE "payroll_items" ADD COLUMN "sequence" INTEGER;

WITH ordered AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "payroll_job_id" ORDER BY "created_at", "id"
  ) - 1 AS item_sequence
  FROM "payroll_items"
)
UPDATE "payroll_items" AS item
SET "sequence" = ordered.item_sequence
FROM ordered
WHERE item."id" = ordered."id";

ALTER TABLE "payroll_items" ALTER COLUMN "sequence" SET NOT NULL;

ALTER TABLE "payroll_jobs"
  ADD CONSTRAINT "payroll_jobs_queue_failure_count_check"
  CHECK ("queue_failure_count" >= 0);

ALTER TABLE "payroll_items"
  ADD CONSTRAINT "payroll_items_sequence_check" CHECK ("sequence" >= 0);

DROP INDEX "payroll_items_job_status_id_idx";
CREATE UNIQUE INDEX "payroll_items_job_sequence_key"
  ON "payroll_items"("payroll_job_id", "sequence");
CREATE INDEX "payroll_items_job_status_sequence_idx"
  ON "payroll_items"("payroll_job_id", "status", "sequence");
