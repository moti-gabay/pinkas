#!/bin/bash
# Reads per-role passwords from docker secrets and applies them. Runs once on first cluster init.
set -euo pipefail
for role in migrator api worker readonly backup; do
  pw="$(cat "/run/secrets/pg_${role}_password")"
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "ALTER ROLE pinkas_${role} PASSWORD '${pw//\'/\'\'}';"
done
