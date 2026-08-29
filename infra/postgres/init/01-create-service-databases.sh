#!/usr/bin/env bash
set -Eeuo pipefail

create_service_database() {
  local role_name="$1"
  local database_name="$2"
  local role_password="$3"

  psql --set=ON_ERROR_STOP=1 \
    --username "$POSTGRES_USER" \
    --dbname postgres \
    --set=role_name="$role_name" \
    --set=database_name="$database_name" \
    --set=role_password="$role_password" <<'SQL'
SELECT format(
  'CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
  :'role_name'
)
WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = :'role_name') \gexec

SELECT format(
  'ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L',
  :'role_name',
  :'role_password'
) \gexec

SELECT format('CREATE DATABASE %I OWNER %I', :'database_name', :'role_name')
WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_database WHERE datname = :'database_name') \gexec

SELECT format('ALTER DATABASE %I OWNER TO %I', :'database_name', :'role_name') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'database_name') \gexec
SELECT format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO %I', :'database_name', :'role_name') \gexec
SQL

  psql --set=ON_ERROR_STOP=1 \
    --username "$POSTGRES_USER" \
    --dbname "$database_name" \
    --set=role_name="$role_name" <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SELECT format('GRANT ALL ON SCHEMA public TO %I', :'role_name') \gexec
SQL
}

create_service_database account_user account_db "$ACCOUNT_DB_PASSWORD"
create_service_database transaction_user transaction_db "$TRANSACTION_DB_PASSWORD"
create_service_database ledger_user ledger_db "$LEDGER_DB_PASSWORD"
create_service_database fx_user fx_db "$FX_DB_PASSWORD"
create_service_database payroll_user payroll_db "$PAYROLL_DB_PASSWORD"
create_service_database admin_user admin_db "$ADMIN_DB_PASSWORD"
