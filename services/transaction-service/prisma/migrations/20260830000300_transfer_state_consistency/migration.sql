ALTER TABLE "transfers"
  ADD CONSTRAINT "transfers_terminal_state_check" CHECK (
    (
      "status" IN ('PENDING', 'PROCESSING')
      AND "ledger_transaction_id" IS NULL
      AND "completed_at" IS NULL
      AND "failure_code" IS NULL
      AND "failure_message" IS NULL
    )
    OR
    (
      "status" = 'FAILED'
      AND "ledger_transaction_id" IS NULL
      AND "completed_at" IS NULL
      AND "failure_code" IS NOT NULL
      AND "failure_message" IS NOT NULL
    )
    OR
    (
      "status" IN ('COMPLETED', 'REVERSED')
      AND "ledger_transaction_id" IS NOT NULL
      AND "completed_at" IS NOT NULL
      AND "failure_code" IS NULL
      AND "failure_message" IS NULL
    )
  );

ALTER TABLE "idempotency_records"
  ADD CONSTRAINT "idempotency_records_result_check" CHECK (
    (
      "state" = 'PROCESSING'
      AND "response_status" IS NULL
      AND "response_body" IS NULL
    )
    OR
    (
      "state" IN ('COMPLETED', 'FAILED')
      AND "response_status" IS NOT NULL
      AND "response_body" IS NOT NULL
    )
  );
