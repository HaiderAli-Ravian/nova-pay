CREATE OR REPLACE FUNCTION "deny_audit_record_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_records are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "audit_records_immutable"
BEFORE UPDATE OR DELETE OR TRUNCATE ON "audit_records"
FOR EACH STATEMENT
EXECUTE FUNCTION "deny_audit_record_mutation"();

REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "audit_records" FROM PUBLIC;
