# Backup and restore

Lands with Phase 4. Design: nightly `pg_dump -Fc` by `pinkas_backup` piped through `age -r <recipient>` to `data/backups/`, 30 daily + 12 monthly retained. `scripts/restore-drill.sh` restores the latest dump into the throwaway `docker-compose.test.yml` database and runs `scripts/invariants.sql`.
