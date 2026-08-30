CREATE OR REPLACE FUNCTION novapay_guard_fx_quote_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    OLD."client_id", OLD."source_currency", OLD."target_currency",
    OLD."source_amount", OLD."target_amount", OLD."rate",
    OLD."provider_reference", OLD."issued_at", OLD."expires_at",
    OLD."created_request_id"
  ) IS DISTINCT FROM ROW(
    NEW."client_id", NEW."source_currency", NEW."target_currency",
    NEW."source_amount", NEW."target_amount", NEW."rate",
    NEW."provider_reference", NEW."issued_at", NEW."expires_at",
    NEW."created_request_id"
  ) THEN
    RAISE EXCEPTION 'FX quote terms are immutable' USING ERRCODE = '55000';
  END IF;

  IF OLD."status" <> NEW."status" AND NOT (
    OLD."status" = 'ACTIVE' AND NEW."status" IN ('CONSUMED', 'EXPIRED')
  ) THEN
    RAISE EXCEPTION 'invalid FX quote status transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER fx_quotes_update_guard
BEFORE UPDATE ON "fx_quotes"
FOR EACH ROW EXECUTE FUNCTION novapay_guard_fx_quote_update();
