import { pgTable, uuid, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const codexAccountPool = pgTable(
  "codex_account_pool",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    label: text("label").notNull(),
    email: text("email"),
    planType: text("plan_type"),
    authJson: text("auth_json").notNull(),
    codexHomePath: text("codex_home_path"),
    status: text("status").notNull().default("active"),
    priority: integer("priority").notNull().default(0),
    exhaustedAt: timestamp("exhausted_at", { withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("codex_account_pool_company_idx").on(table.companyId),
    companyStatusIdx: index("codex_account_pool_company_status_idx").on(table.companyId, table.status),
    companyPriorityIdx: index("codex_account_pool_company_priority_idx").on(table.companyId, table.priority),
  }),
);
