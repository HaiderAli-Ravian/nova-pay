CREATE TYPE "QuoteStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'EXPIRED');

CREATE TABLE "fx_quotes" (
  "id" UUID NOT NULL,
  "client_id" VARCHAR(100) NOT NULL,
  "source_currency" CHAR(3) NOT NULL,
  "target_currency" CHAR(3) NOT NULL,
  "source_amount" NUMERIC(28,8) NOT NULL,
  "target_amount" NUMERIC(28,8) NOT NULL,
  "rate" NUMERIC(28,12) NOT NULL,
  "provider_reference" VARCHAR(120) NOT NULL,
  "status" "QuoteStatus" NOT NULL DEFAULT 'ACTIVE',
  "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "consumed_at" TIMESTAMPTZ(6),
  "consumed_by_transfer_id" UUID,
  "created_request_id" UUID NOT NULL,
  CONSTRAINT "fx_quotes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fx_quotes_currency_check" CHECK ("source_currency" ~ '^[A-Z]{3}$' AND "target_currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "fx_quotes_currency_pair_check" CHECK ("source_currency" <> "target_currency"),
  CONSTRAINT "fx_quotes_amounts_check" CHECK ("source_amount" > 0 AND "target_amount" > 0 AND "rate" > 0),
  CONSTRAINT "fx_quotes_ttl_check" CHECK ("expires_at" = "issued_at" + INTERVAL '60 seconds'),
  CONSTRAINT "fx_quotes_consumption_check" CHECK (("status" = 'CONSUMED') = ("consumed_at" IS NOT NULL AND "consumed_by_transfer_id" IS NOT NULL))
);

CREATE UNIQUE INDEX "fx_quotes_consumed_by_transfer_id_key" ON "fx_quotes"("consumed_by_transfer_id") WHERE "consumed_by_transfer_id" IS NOT NULL;
CREATE INDEX "fx_quotes_client_id_issued_at_idx" ON "fx_quotes"("client_id", "issued_at" DESC);
CREATE INDEX "fx_quotes_status_expires_at_idx" ON "fx_quotes"("status", "expires_at");
