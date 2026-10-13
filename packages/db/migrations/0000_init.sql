CREATE TYPE "public"."account_type" AS ENUM('checking', 'credit_card', 'savings');--> statement-breakpoint
CREATE TYPE "public"."cadence" AS ENUM('weekly', 'monthly', 'bimonthly', 'quarterly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."category_kind" AS ENUM('expense', 'income', 'transfer');--> statement-breakpoint
CREATE TYPE "public"."category_source" AS ENUM('rule', 'ai', 'manual', 'refund_link', 'default');--> statement-breakpoint
CREATE TYPE "public"."created_by" AS ENUM('system', 'user');--> statement-breakpoint
CREATE TYPE "public"."exclude_reason" AS ENUM('card_settlement', 'internal_transfer', 'duplicate', 'user');--> statement-breakpoint
CREATE TYPE "public"."hash_kind" AS ENUM('identifier', 'fields');--> statement-breakpoint
CREATE TYPE "public"."import_decision" AS ENUM('insert', 'duplicate', 'update_pending', 'error');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('uploaded', 'parsed', 'awaiting_confirm', 'committed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."insight_kind" AS ENUM('monthly_summary', 'anomaly', 'budget', 'recurring');--> statement-breakpoint
CREATE TYPE "public"."link_kind" AS ENUM('card_settlement', 'transfer', 'refund', 'pending_update');--> statement-breakpoint
CREATE TYPE "public"."llm_mode" AS ENUM('none', 'redacted_text', 'raw_pdf');--> statement-breakpoint
CREATE TYPE "public"."recurring_status" AS ENUM('active', 'paused', 'ended', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."rule_field" AS ENUM('merchant_normalized', 'description_raw');--> statement-breakpoint
CREATE TYPE "public"."rule_match" AS ENUM('contains', 'exact', 'regex', 'prefix');--> statement-breakpoint
CREATE TYPE "public"."rule_origin" AS ENUM('seed', 'user', 'learned');--> statement-breakpoint
CREATE TYPE "public"."settlement_status" AS ENUM('matched', 'partial', 'unmatched');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('scraper', 'file');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('running', 'success', 'failed', 'partial');--> statement-breakpoint
CREATE TYPE "public"."sync_trigger" AS ENUM('schedule', 'manual');--> statement-breakpoint
CREATE TYPE "public"."txn_origin" AS ENUM('scraper', 'import', 'manual');--> statement-breakpoint
CREATE TYPE "public"."txn_status" AS ENUM('pending', 'completed');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"masked_label" text NOT NULL,
	"type" "account_type" NOT NULL,
	"currency" char(3) DEFAULT 'ILS' NOT NULL,
	"display_name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"balance_agorot" bigint,
	"balance_at" timestamp with time zone,
	"card_cycle_day" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "balance_snapshots" (
	"account_id" uuid NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"balance_agorot" bigint NOT NULL,
	CONSTRAINT "balance_snapshots_account_id_as_of_pk" PRIMARY KEY("account_id","as_of")
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"amount_agorot" bigint NOT NULL,
	"effective_from" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_txn_id" uuid NOT NULL,
	"card_account_id" uuid NOT NULL,
	"cycle_date" date NOT NULL,
	"expected_total_agorot" bigint NOT NULL,
	"status" "settlement_status" NOT NULL,
	"diff_agorot" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_settlements_bank_txn_id_unique" UNIQUE("bank_txn_id")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"slug" text NOT NULL,
	"name_he" text NOT NULL,
	"kind" "category_kind" NOT NULL,
	"is_fixed_default" boolean DEFAULT false NOT NULL,
	"icon" text,
	"sort" smallint DEFAULT 0 NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "category_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pattern" text NOT NULL,
	"match" "rule_match" DEFAULT 'contains' NOT NULL,
	"field" "rule_field" DEFAULT 'merchant_normalized' NOT NULL,
	"category_id" uuid NOT NULL,
	"is_fixed" boolean,
	"priority" integer DEFAULT 100 NOT NULL,
	"account_scope" uuid,
	"enabled" boolean DEFAULT true NOT NULL,
	"origin" "rule_origin" DEFAULT 'user' NOT NULL,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"source_id" uuid PRIMARY KEY NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"key_fingerprint" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expected_income" (
	"month" date PRIMARY KEY NOT NULL,
	"amount_agorot" bigint NOT NULL,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"import_id" uuid NOT NULL,
	"row_index" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"parsed" jsonb,
	"dedupe_hash" text,
	"decision" "import_decision",
	"error" text,
	CONSTRAINT "import_rows_import_id_row_index_pk" PRIMARY KEY("import_id","row_index")
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_name" text NOT NULL,
	"file_sha256" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"mime" text NOT NULL,
	"parser_id" text,
	"account_id" uuid,
	"status" "import_status" DEFAULT 'uploaded' NOT NULL,
	"llm_mode" "llm_mode" DEFAULT 'none' NOT NULL,
	"column_mapping" jsonb,
	"table_index" smallint DEFAULT 0 NOT NULL,
	"rows_parsed" integer DEFAULT 0 NOT NULL,
	"rows_added" integer DEFAULT 0 NOT NULL,
	"rows_skipped" integer DEFAULT 0 NOT NULL,
	"statement_total_agorot" bigint,
	"computed_total_agorot" bigint,
	"reconciled" boolean,
	"error" text,
	"file_deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month" date NOT NULL,
	"kind" "insight_kind" NOT NULL,
	"facts" jsonb NOT NULL,
	"content_he" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer,
	"ok" boolean NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"merchant_normalized" text NOT NULL,
	"category_id" uuid,
	"cadence" "cadence" NOT NULL,
	"typical_amount_agorot" bigint NOT NULL,
	"amount_tolerance_pct" smallint DEFAULT 10 NOT NULL,
	"day_of_month" smallint,
	"first_seen" date NOT NULL,
	"last_seen" date NOT NULL,
	"next_expected" date,
	"occurrences" integer NOT NULL,
	"status" "recurring_status" DEFAULT 'active' NOT NULL,
	"is_new" boolean DEFAULT false NOT NULL,
	"user_confirmed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "source_kind" NOT NULL,
	"company_id" text,
	"display_name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"schedule_cron" text,
	"hash_kind" "hash_kind" DEFAULT 'identifier' NOT NULL,
	"hash_kind_downgraded_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error_type" text,
	"last_error_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"trigger" "sync_trigger" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "sync_status" DEFAULT 'running' NOT NULL,
	"error_type" text,
	"error_message" text,
	"accounts_seen" integer DEFAULT 0 NOT NULL,
	"rows_added" integer DEFAULT 0 NOT NULL,
	"rows_updated" integer DEFAULT 0 NOT NULL,
	"rows_linked" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "transaction_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "link_kind" NOT NULL,
	"from_txn_id" uuid NOT NULL,
	"to_txn_id" uuid NOT NULL,
	"confidence" numeric(3, 2),
	"created_by" "created_by" DEFAULT 'system' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"dedupe_hash" text NOT NULL,
	"hash_version" smallint DEFAULT 1 NOT NULL,
	"hash_kind" "hash_kind" NOT NULL,
	"previous_hashes" text[] DEFAULT '{}'::text[] NOT NULL,
	"origin" "txn_origin" NOT NULL,
	"import_id" uuid,
	"external_identifier" text,
	"txn_date" date NOT NULL,
	"processed_date" date,
	"charged_amount_agorot" bigint NOT NULL,
	"original_amount_minor" bigint,
	"original_currency" char(3),
	"status" "txn_status" NOT NULL,
	"description_raw" text NOT NULL,
	"merchant_normalized" text NOT NULL,
	"memo" text,
	"installment_number" smallint,
	"installment_total" smallint,
	"installment_group_key" text,
	"category_id" uuid,
	"category_source" "category_source",
	"category_confidence" numeric(3, 2),
	"category_rule_id" uuid,
	"is_fixed" boolean,
	"exclude_reason" "exclude_reason",
	"counted_in_cashflow" boolean GENERATED ALWAYS AS (exclude_reason IS NULL) STORED NOT NULL,
	"stale_pending" boolean DEFAULT false NOT NULL,
	"notes" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_installment_pair_chk" CHECK ((installment_number IS NULL) = (installment_total IS NULL)),
	CONSTRAINT "transactions_installment_range_chk" CHECK (installment_number IS NULL OR (installment_number >= 1 AND installment_number <= installment_total))
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_snapshots" ADD CONSTRAINT "balance_snapshots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_settlements" ADD CONSTRAINT "card_settlements_bank_txn_id_transactions_id_fk" FOREIGN KEY ("bank_txn_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_settlements" ADD CONSTRAINT "card_settlements_card_account_id_accounts_id_fk" FOREIGN KEY ("card_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_account_scope_accounts_id_fk" FOREIGN KEY ("account_scope") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_series" ADD CONSTRAINT "recurring_series_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_series" ADD CONSTRAINT "recurring_series_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_links" ADD CONSTRAINT "transaction_links_from_txn_id_transactions_id_fk" FOREIGN KEY ("from_txn_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_links" ADD CONSTRAINT "transaction_links_to_txn_id_transactions_id_fk" FOREIGN KEY ("to_txn_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_rule_id_category_rules_id_fk" FOREIGN KEY ("category_rule_id") REFERENCES "public"."category_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_source_external_uq" ON "accounts" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_category_from_uq" ON "budgets" USING btree ("category_id","effective_from");--> statement-breakpoint
CREATE INDEX "category_rules_enabled_priority_idx" ON "category_rules" USING btree ("enabled","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "imports_sha_committed_uq" ON "imports" USING btree ("file_sha256") WHERE status = 'committed';--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_series_uq" ON "recurring_series" USING btree ("account_id","merchant_normalized","cadence");--> statement-breakpoint
CREATE INDEX "sync_runs_source_started_idx" ON "sync_runs" USING btree ("source_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_links_uq" ON "transaction_links" USING btree ("kind","from_txn_id","to_txn_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_hash_uq" ON "transactions" USING btree ("hash_version","dedupe_hash");--> statement-breakpoint
CREATE INDEX "transactions_account_ext_idx" ON "transactions" USING btree ("account_id","external_identifier") WHERE external_identifier IS NOT NULL;--> statement-breakpoint
CREATE INDEX "transactions_account_date_idx" ON "transactions" USING btree ("account_id","txn_date");--> statement-breakpoint
CREATE INDEX "transactions_date_counted_idx" ON "transactions" USING btree ("txn_date") WHERE exclude_reason IS NULL;--> statement-breakpoint
CREATE INDEX "transactions_category_date_idx" ON "transactions" USING btree ("category_id","txn_date");--> statement-breakpoint
CREATE INDEX "transactions_merchant_idx" ON "transactions" USING btree ("merchant_normalized");--> statement-breakpoint
CREATE INDEX "transactions_tags_idx" ON "transactions" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "transactions_pending_idx" ON "transactions" USING btree ("status") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "transactions_installment_group_idx" ON "transactions" USING btree ("installment_group_key");