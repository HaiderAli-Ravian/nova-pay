CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED');
CREATE TYPE "WalletStatus" AS ENUM ('PENDING', 'ACTIVE', 'FROZEN', 'CLOSED');

CREATE TABLE "users" (
  "id" UUID NOT NULL,
  "external_ref" VARCHAR(100) NOT NULL,
  "identity_ciphertext" BYTEA NOT NULL,
  "identity_iv" BYTEA NOT NULL,
  "identity_auth_tag" BYTEA NOT NULL,
  "encrypted_dek" BYTEA NOT NULL,
  "dek_iv" BYTEA NOT NULL,
  "dek_auth_tag" BYTEA NOT NULL,
  "key_version" VARCHAR(40) NOT NULL,
  "email_lookup_hmac" BYTEA,
  "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wallets" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "label" VARCHAR(80),
  "status" "WalletStatus" NOT NULL DEFAULT 'PENDING',
  "ledger_account_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wallets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wallets_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "users_external_ref_key" ON "users"("external_ref");
CREATE UNIQUE INDEX "users_email_lookup_hmac_key" ON "users"("email_lookup_hmac") WHERE "email_lookup_hmac" IS NOT NULL;
CREATE INDEX "users_status_created_at_idx" ON "users"("status", "created_at");
CREATE UNIQUE INDEX "wallets_user_id_currency_key" ON "wallets"("user_id", "currency");
CREATE UNIQUE INDEX "wallets_ledger_account_id_key" ON "wallets"("ledger_account_id") WHERE "ledger_account_id" IS NOT NULL;
CREATE INDEX "wallets_user_id_status_idx" ON "wallets"("user_id", "status");
