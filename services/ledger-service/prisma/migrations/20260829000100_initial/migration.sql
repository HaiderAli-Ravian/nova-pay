CREATE TYPE "LedgerAccountType" AS ENUM ('CUSTOMER', 'FX_CLEARING', 'FEE_REVENUE');
CREATE TYPE "NormalSide" AS ENUM ('DEBIT', 'CREDIT');
CREATE TYPE "LedgerAccountStatus" AS ENUM ('ACTIVE', 'FROZEN', 'CLOSED');
CREATE TYPE "PostingType" AS ENUM ('TRANSFER', 'FX_TRANSFER', 'FEE', 'REVERSAL', 'FUNDING');
CREATE TYPE "LedgerTransactionStatus" AS ENUM ('POSTED');
CREATE TYPE "EntryDirection" AS ENUM ('DEBIT', 'CREDIT');

CREATE TABLE "ledger_accounts" (
  "id" UUID NOT NULL,
  "wallet_id" UUID,
  "account_type" "LedgerAccountType" NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "normal_side" "NormalSide" NOT NULL,
  "status" "LedgerAccountStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ledger_accounts_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "ledger_accounts_owner_check" CHECK (("account_type" = 'CUSTOMER') = ("wallet_id" IS NOT NULL))
);

CREATE TABLE "wallet_balances" (
  "ledger_account_id" UUID NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "available_balance" NUMERIC(28,8) NOT NULL DEFAULT 0,
  "version" BIGINT NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wallet_balances_pkey" PRIMARY KEY ("ledger_account_id"),
  CONSTRAINT "wallet_balances_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "wallet_balances_version_check" CHECK ("version" >= 0),
  CONSTRAINT "wallet_balances_ledger_account_id_fkey" FOREIGN KEY ("ledger_account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ledger_transactions" (
  "id" UUID NOT NULL,
  "external_reference" UUID NOT NULL,
  "posting_type" "PostingType" NOT NULL,
  "status" "LedgerTransactionStatus" NOT NULL DEFAULT 'POSTED',
  "source_currency" CHAR(3) NOT NULL,
  "target_currency" CHAR(3) NOT NULL,
  "source_amount" NUMERIC(28,8) NOT NULL,
  "target_amount" NUMERIC(28,8) NOT NULL,
  "fx_quote_id" UUID,
  "locked_fx_rate" NUMERIC(28,12),
  "reverses_transaction_id" UUID,
  "posted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "request_id" UUID NOT NULL,
  CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ledger_transactions_currency_check" CHECK ("source_currency" ~ '^[A-Z]{3}$' AND "target_currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "ledger_transactions_amount_check" CHECK ("source_amount" > 0 AND "target_amount" > 0),
  CONSTRAINT "ledger_transactions_fx_check" CHECK (
    ("posting_type" = 'FX_TRANSFER' AND "source_currency" <> "target_currency" AND "fx_quote_id" IS NOT NULL AND "locked_fx_rate" > 0)
    OR
    ("posting_type" <> 'FX_TRANSFER' AND "source_currency" = "target_currency" AND "fx_quote_id" IS NULL AND "locked_fx_rate" IS NULL)
  ),
  CONSTRAINT "ledger_transactions_reversal_check" CHECK (("posting_type" = 'REVERSAL') = ("reverses_transaction_id" IS NOT NULL)),
  CONSTRAINT "ledger_transactions_reverses_transaction_id_fkey" FOREIGN KEY ("reverses_transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ledger_entries" (
  "id" UUID NOT NULL,
  "ledger_transaction_id" UUID NOT NULL,
  "ledger_account_id" UUID NOT NULL,
  "sequence" SMALLINT NOT NULL,
  "direction" "EntryDirection" NOT NULL,
  "amount" NUMERIC(28,8) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "fx_quote_id" UUID,
  "locked_fx_rate" NUMERIC(28,12),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ledger_entries_sequence_check" CHECK ("sequence" > 0),
  CONSTRAINT "ledger_entries_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "ledger_entries_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "ledger_entries_fx_check" CHECK (("fx_quote_id" IS NULL AND "locked_fx_rate" IS NULL) OR ("fx_quote_id" IS NOT NULL AND "locked_fx_rate" > 0)),
  CONSTRAINT "ledger_entries_transaction_id_fkey" FOREIGN KEY ("ledger_transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ledger_entries_account_id_fkey" FOREIGN KEY ("ledger_account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ledger_invariant_checks" (
  "id" UUID NOT NULL,
  "check_type" VARCHAR(40) NOT NULL,
  "violations" INTEGER NOT NULL,
  "details" JSONB,
  "checked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ledger_invariant_checks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ledger_invariant_checks_violations_check" CHECK ("violations" >= 0)
);

CREATE UNIQUE INDEX "ledger_accounts_wallet_id_key" ON "ledger_accounts"("wallet_id") WHERE "wallet_id" IS NOT NULL;
CREATE UNIQUE INDEX "ledger_accounts_internal_type_currency_key" ON "ledger_accounts"("account_type", "currency") WHERE "account_type" IN ('FX_CLEARING', 'FEE_REVENUE');
CREATE INDEX "ledger_accounts_currency_status_idx" ON "ledger_accounts"("currency", "status");
CREATE UNIQUE INDEX "ledger_transactions_external_reference_key" ON "ledger_transactions"("external_reference");
CREATE UNIQUE INDEX "ledger_transactions_reverses_transaction_id_key" ON "ledger_transactions"("reverses_transaction_id");
CREATE INDEX "ledger_transactions_posted_at_id_idx" ON "ledger_transactions"("posted_at" DESC, "id" DESC);
CREATE INDEX "ledger_transactions_fx_quote_id_idx" ON "ledger_transactions"("fx_quote_id");
CREATE UNIQUE INDEX "ledger_entries_transaction_sequence_key" ON "ledger_entries"("ledger_transaction_id", "sequence");
CREATE INDEX "ledger_entries_account_created_id_idx" ON "ledger_entries"("ledger_account_id", "created_at" DESC, "id" DESC);
CREATE INDEX "ledger_entries_transaction_id_idx" ON "ledger_entries"("ledger_transaction_id");
CREATE INDEX "ledger_invariant_checks_type_checked_at_idx" ON "ledger_invariant_checks"("check_type", "checked_at" DESC);
