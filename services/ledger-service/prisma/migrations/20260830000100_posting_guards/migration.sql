ALTER TABLE "ledger_transactions"
  ADD COLUMN "command_hash" CHAR(64) NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000';

ALTER TABLE "ledger_transactions"
  ALTER COLUMN "command_hash" DROP DEFAULT,
  ADD CONSTRAINT "ledger_transactions_command_hash_check" CHECK ("command_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "ledger_transactions"
  DROP CONSTRAINT "ledger_transactions_fx_check",
  ADD CONSTRAINT "ledger_transactions_fx_check" CHECK (
    ("posting_type" = 'FX_TRANSFER' AND "source_currency" <> "target_currency" AND "fx_quote_id" IS NOT NULL AND "locked_fx_rate" > 0)
    OR
    ("posting_type" = 'REVERSAL' AND (
      ("source_currency" = "target_currency" AND "fx_quote_id" IS NULL AND "locked_fx_rate" IS NULL)
      OR
      ("source_currency" <> "target_currency" AND "fx_quote_id" IS NOT NULL AND "locked_fx_rate" > 0)
    ))
    OR
    ("posting_type" NOT IN ('FX_TRANSFER', 'REVERSAL') AND "source_currency" = "target_currency" AND "fx_quote_id" IS NULL AND "locked_fx_rate" IS NULL)
  );

CREATE OR REPLACE FUNCTION novapay_reject_ledger_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ledger journal rows are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER ledger_entries_immutable
BEFORE UPDATE OR DELETE ON "ledger_entries"
FOR EACH ROW EXECUTE FUNCTION novapay_reject_ledger_mutation();

CREATE TRIGGER ledger_transactions_immutable
BEFORE UPDATE OR DELETE ON "ledger_transactions"
FOR EACH ROW EXECUTE FUNCTION novapay_reject_ledger_mutation();

CREATE OR REPLACE FUNCTION novapay_verify_balanced_posting()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  invalid_currency_count INTEGER;
  entry_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO entry_count
  FROM "ledger_entries"
  WHERE "ledger_transaction_id" = NEW."id";

  SELECT COUNT(*) INTO invalid_currency_count
  FROM (
    SELECT "currency"
    FROM "ledger_entries"
    WHERE "ledger_transaction_id" = NEW."id"
    GROUP BY "currency"
    HAVING SUM(CASE WHEN "direction" = 'DEBIT' THEN "amount" ELSE 0 END)
         <> SUM(CASE WHEN "direction" = 'CREDIT' THEN "amount" ELSE 0 END)
  ) AS invalid_currency;

  IF entry_count < 2 OR invalid_currency_count > 0 THEN
    RAISE EXCEPTION 'ledger posting is not balanced' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER ledger_transactions_balanced
AFTER INSERT ON "ledger_transactions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION novapay_verify_balanced_posting();
