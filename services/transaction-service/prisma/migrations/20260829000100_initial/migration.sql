CREATE TYPE "IdempotencyState" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE "TransferType" AS ENUM ('DOMESTIC', 'INTERNATIONAL');
CREATE TYPE "TransferStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REVERSED');
CREATE TYPE "TransferRole" AS ENUM ('SENDER', 'RECIPIENT');

CREATE TABLE "transfers" (
  "id" UUID NOT NULL,
  "client_id" VARCHAR(100) NOT NULL,
  "type" "TransferType" NOT NULL,
  "status" "TransferStatus" NOT NULL DEFAULT 'PENDING',
  "sender_wallet_id" UUID NOT NULL,
  "recipient_wallet_id" UUID NOT NULL,
  "source_currency" CHAR(3) NOT NULL,
  "source_amount" NUMERIC(28,8) NOT NULL,
  "target_currency" CHAR(3) NOT NULL,
  "target_amount" NUMERIC(28,8),
  "fx_quote_id" UUID,
  "locked_fx_rate" NUMERIC(28,12),
  "ledger_transaction_id" UUID,
  "failure_code" VARCHAR(80),
  "failure_message" VARCHAR(300),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),
  "version" BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT "transfers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "transfers_wallets_check" CHECK ("sender_wallet_id" <> "recipient_wallet_id"),
  CONSTRAINT "transfers_currency_check" CHECK ("source_currency" ~ '^[A-Z]{3}$' AND "target_currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "transfers_amount_check" CHECK ("source_amount" > 0 AND ("target_amount" IS NULL OR "target_amount" > 0)),
  CONSTRAINT "transfers_version_check" CHECK ("version" >= 0),
  CONSTRAINT "transfers_type_check" CHECK (
    ("type" = 'DOMESTIC' AND "source_currency" = "target_currency" AND "fx_quote_id" IS NULL AND "locked_fx_rate" IS NULL)
    OR
    ("type" = 'INTERNATIONAL' AND "source_currency" <> "target_currency" AND "fx_quote_id" IS NOT NULL AND "locked_fx_rate" > 0 AND "target_amount" IS NOT NULL)
  )
);

CREATE TABLE "idempotency_records" (
  "id" UUID NOT NULL,
  "client_id" VARCHAR(100) NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "state" "IdempotencyState" NOT NULL DEFAULT 'PROCESSING',
  "transfer_id" UUID NOT NULL,
  "response_status" SMALLINT,
  "response_body" JSONB,
  "replay_expires_at" TIMESTAMPTZ(6) NOT NULL,
  "retention_until" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "idempotency_records_hash_check" CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "idempotency_records_expiry_check" CHECK ("retention_until" >= "replay_expires_at"),
  CONSTRAINT "idempotency_records_response_status_check" CHECK ("response_status" IS NULL OR "response_status" BETWEEN 100 AND 599),
  CONSTRAINT "idempotency_records_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "transaction_history" (
  "id" UUID NOT NULL,
  "transfer_id" UUID NOT NULL,
  "wallet_id" UUID NOT NULL,
  "role" "TransferRole" NOT NULL,
  "counterparty_wallet_id" UUID NOT NULL,
  "status" "TransferStatus" NOT NULL,
  "amount" NUMERIC(28,8) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "fx_quote_id" UUID,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "transaction_history_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "transaction_history_wallets_check" CHECK ("wallet_id" <> "counterparty_wallet_id"),
  CONSTRAINT "transaction_history_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "transaction_history_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "transaction_history_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "idempotency_records_client_id_key_key" ON "idempotency_records"("client_id", "idempotency_key");
CREATE UNIQUE INDEX "idempotency_records_transfer_id_key" ON "idempotency_records"("transfer_id");
CREATE INDEX "idempotency_records_state_updated_at_idx" ON "idempotency_records"("state", "updated_at");
CREATE INDEX "idempotency_records_retention_until_idx" ON "idempotency_records"("retention_until");
CREATE UNIQUE INDEX "transfers_fx_quote_id_key" ON "transfers"("fx_quote_id") WHERE "fx_quote_id" IS NOT NULL;
CREATE UNIQUE INDEX "transfers_ledger_transaction_id_key" ON "transfers"("ledger_transaction_id") WHERE "ledger_transaction_id" IS NOT NULL;
CREATE INDEX "transfers_client_id_created_at_idx" ON "transfers"("client_id", "created_at" DESC);
CREATE INDEX "transfers_status_updated_at_idx" ON "transfers"("status", "updated_at");
CREATE INDEX "transfers_sender_wallet_id_created_at_idx" ON "transfers"("sender_wallet_id", "created_at" DESC);
CREATE UNIQUE INDEX "transaction_history_transfer_wallet_role_key" ON "transaction_history"("transfer_id", "wallet_id", "role");
CREATE INDEX "transaction_history_wallet_occurred_id_idx" ON "transaction_history"("wallet_id", "occurred_at" DESC, "id" DESC);
CREATE INDEX "transaction_history_transfer_id_idx" ON "transaction_history"("transfer_id");
