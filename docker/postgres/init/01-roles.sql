-- Least-privilege roles. Passwords come from docker secrets via 02-passwords.sh (generated, never committed).
-- Grants on tables are applied by the migration script after each migration (packages/db/grants.sql),
-- so new tables never silently become readable by the wrong role.
CREATE ROLE pinkas_migrator LOGIN;
CREATE ROLE pinkas_api LOGIN;
CREATE ROLE pinkas_worker LOGIN;
CREATE ROLE pinkas_readonly LOGIN;
CREATE ROLE pinkas_backup LOGIN;

ALTER ROLE pinkas_readonly SET default_transaction_read_only = on;
ALTER ROLE pinkas_backup SET default_transaction_read_only = on;

GRANT CONNECT ON DATABASE pinkas TO pinkas_api, pinkas_worker, pinkas_readonly, pinkas_backup, pinkas_migrator;
ALTER DATABASE pinkas OWNER TO pinkas_migrator;
