ALTER TABLE "category_rules" DROP CONSTRAINT "category_rules_seed_key_unique";--> statement-breakpoint
ALTER TABLE "category_rules" DROP COLUMN "seed_key";--> statement-breakpoint
DROP TABLE "seed_versions";
