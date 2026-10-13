-- Postgres cannot drop an enum value; queued rows are deleted and the value stays (harmless).
DELETE FROM sync_runs WHERE status = 'queued';
