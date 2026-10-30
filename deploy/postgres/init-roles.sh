#!/bin/sh
# First-start only (docker-entrypoint-initdb.d). Creates the two roles from operations.md:
# the migration role owns the schema; the application role only reads and writes rows.
set -eu

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v migrator="$MIGRATION_DB_USER" -v migrator_password="$MIGRATION_DB_PASSWORD" \
  -v app="$APP_DB_USER" -v app_password="$APP_DB_PASSWORD" \
  -v db="$POSTGRES_DB" <<'SQL'
CREATE ROLE :"migrator" LOGIN PASSWORD :'migrator_password';
CREATE ROLE :"app" LOGIN PASSWORD :'app_password';

REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"db" TO :"migrator", :"app";

ALTER SCHEMA public OWNER TO :"migrator";
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"app";

ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app";
SQL
