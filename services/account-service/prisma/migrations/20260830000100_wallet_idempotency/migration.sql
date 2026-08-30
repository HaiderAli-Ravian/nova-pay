CREATE TABLE "wallet_idempotency_records" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "wallet_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wallet_idempotency_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wallet_idempotency_records_hash_check" CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "wallet_idempotency_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wallet_idempotency_records_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "wallet_idempotency_records_wallet_id_key" ON "wallet_idempotency_records"("wallet_id");
CREATE UNIQUE INDEX "wallet_idempotency_records_user_key_key" ON "wallet_idempotency_records"("user_id", "idempotency_key");
