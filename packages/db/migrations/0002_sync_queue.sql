-- Manual "sync now" requests are rows in sync_runs with status 'queued'; the worker claims them.
ALTER TYPE "public"."sync_status" ADD VALUE IF NOT EXISTS 'queued' BEFORE 'running';
