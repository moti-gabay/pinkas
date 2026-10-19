-- Versioned reference data. `migrate up` applies only seed items newer than the stored version, and only adds
-- rows (ON CONFLICT DO NOTHING), so a seed rule the user deleted or edited never comes back.
CREATE TABLE "seed_versions" (
	"name" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "category_rules" ADD COLUMN "seed_key" text;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_seed_key_unique" UNIQUE("seed_key");--> statement-breakpoint
-- Databases seeded before versioning: key their seed rules and record version 1 (the seed set of that time),
-- so the first versioned run does not re-add seed rules the user already deleted.
UPDATE "category_rules" r SET "seed_key" = c."slug" || ':' || r."pattern"
  FROM "categories" c
  WHERE c."id" = r."category_id" AND r."origin" = 'seed';--> statement-breakpoint
INSERT INTO "seed_versions" ("name", "version")
  SELECT 'taxonomy', 1 WHERE EXISTS (SELECT 1 FROM "categories" WHERE "is_system");
