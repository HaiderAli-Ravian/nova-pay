ALTER TABLE "transfers" DROP CONSTRAINT "transfers_type_check";

ALTER TABLE "transfers"
  ADD CONSTRAINT "transfers_type_check" CHECK (
    (
      "type" = 'DOMESTIC'
      AND "source_currency" = "target_currency"
      AND "target_amount" = "source_amount"
      AND "fx_quote_id" IS NULL
      AND "locked_fx_rate" IS NULL
    )
    OR
    (
      "type" = 'INTERNATIONAL'
      AND "source_currency" <> "target_currency"
      AND "fx_quote_id" IS NOT NULL
      AND (
        ("target_amount" IS NULL AND "locked_fx_rate" IS NULL)
        OR
        ("target_amount" > 0 AND "locked_fx_rate" > 0)
      )
    )
  );

ALTER TABLE "transfers"
  ADD CONSTRAINT "transfers_international_execution_check" CHECK (
    "type" <> 'INTERNATIONAL'
    OR "status" IN ('PENDING', 'FAILED')
    OR ("target_amount" IS NOT NULL AND "locked_fx_rate" IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION novapay_guard_transfer_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    OLD."client_id",
    OLD."type",
    OLD."sender_wallet_id",
    OLD."recipient_wallet_id",
    OLD."source_currency",
    OLD."source_amount",
    OLD."target_currency",
    OLD."fx_quote_id"
  ) IS DISTINCT FROM ROW(
    NEW."client_id",
    NEW."type",
    NEW."sender_wallet_id",
    NEW."recipient_wallet_id",
    NEW."source_currency",
    NEW."source_amount",
    NEW."target_currency",
    NEW."fx_quote_id"
  ) THEN
    RAISE EXCEPTION 'transfer command fields are immutable' USING ERRCODE = '55000';
  END IF;

  IF ROW(OLD."target_amount", OLD."locked_fx_rate")
     IS DISTINCT FROM ROW(NEW."target_amount", NEW."locked_fx_rate")
     AND NOT (
       OLD."type" = 'INTERNATIONAL'
       AND OLD."status" = 'PENDING'
       AND NEW."status" = 'PROCESSING'
       AND OLD."target_amount" IS NULL
       AND OLD."locked_fx_rate" IS NULL
       AND NEW."target_amount" > 0
       AND NEW."locked_fx_rate" > 0
     ) THEN
    RAISE EXCEPTION 'transfer quote terms are immutable after preparation' USING ERRCODE = '55000';
  END IF;

  IF OLD."status" <> NEW."status" AND NOT (
    (OLD."status" = 'PENDING' AND NEW."status" IN ('PROCESSING', 'FAILED'))
    OR
    (OLD."status" = 'PROCESSING' AND NEW."status" IN ('COMPLETED', 'FAILED'))
    OR
    (OLD."status" = 'COMPLETED' AND NEW."status" = 'REVERSED')
  ) THEN
    RAISE EXCEPTION 'invalid transfer status transition' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
