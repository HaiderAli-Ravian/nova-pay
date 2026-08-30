ALTER TABLE "transfers"
  ADD CONSTRAINT "transfers_domestic_amount_check" CHECK (
    "type" <> 'DOMESTIC' OR "target_amount" = "source_amount"
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
    OLD."target_amount",
    OLD."fx_quote_id",
    OLD."locked_fx_rate"
  ) IS DISTINCT FROM ROW(
    NEW."client_id",
    NEW."type",
    NEW."sender_wallet_id",
    NEW."recipient_wallet_id",
    NEW."source_currency",
    NEW."source_amount",
    NEW."target_currency",
    NEW."target_amount",
    NEW."fx_quote_id",
    NEW."locked_fx_rate"
  ) THEN
    RAISE EXCEPTION 'transfer command fields are immutable' USING ERRCODE = '55000';
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

CREATE TRIGGER transfers_update_guard
BEFORE UPDATE ON "transfers"
FOR EACH ROW EXECUTE FUNCTION novapay_guard_transfer_update();

CREATE OR REPLACE FUNCTION novapay_guard_idempotency_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(OLD."client_id", OLD."idempotency_key", OLD."request_hash", OLD."transfer_id")
     IS DISTINCT FROM
     ROW(NEW."client_id", NEW."idempotency_key", NEW."request_hash", NEW."transfer_id") THEN
    RAISE EXCEPTION 'idempotency identity fields are immutable' USING ERRCODE = '55000';
  END IF;

  IF OLD."state" <> NEW."state" AND NOT (
    OLD."state" = 'PROCESSING' AND NEW."state" IN ('COMPLETED', 'FAILED')
  ) THEN
    RAISE EXCEPTION 'invalid idempotency state transition' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER idempotency_records_update_guard
BEFORE UPDATE ON "idempotency_records"
FOR EACH ROW EXECUTE FUNCTION novapay_guard_idempotency_update();
