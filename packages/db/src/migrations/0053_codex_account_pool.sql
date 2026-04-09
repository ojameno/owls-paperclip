CREATE TABLE "codex_account_pool" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"label" text NOT NULL,
	"email" text,
	"plan_type" text,
	"auth_json" text NOT NULL,
	"codex_home_path" text,
	"status" text DEFAULT 'active' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"exhausted_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "codex_account_pool" ADD CONSTRAINT "codex_account_pool_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "codex_account_pool_company_idx" ON "codex_account_pool" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "codex_account_pool_company_status_idx" ON "codex_account_pool" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "codex_account_pool_company_priority_idx" ON "codex_account_pool" USING btree ("company_id","priority");
