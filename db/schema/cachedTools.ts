import { relations } from "drizzle-orm";
import { bigint, index, jsonb, pgTable, text, unique } from "drizzle-orm/pg-core";
import { withTimestamps } from "../lib/with-timestamps";
import { platformCustomers } from "./platformCustomers";

export type CachedToolParameter = {
  type: "string" | "number";
  description?: string;
  optional?: boolean;
};

export type CachedToolParameters = Record<string, CachedToolParameter>;

export type CachedTool = typeof cachedTools.$inferSelect;

export const cachedTools = pgTable(
  "cached_tools",
  {
    ...withTimestamps,
    id: bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    toolName: text("tool_name").notNull(),
    description: text(),
    parameters: jsonb().default("{}").$type<CachedToolParameters>(),
    serverRequestUrl: text("server_request_url").notNull(),
    customerEmail: text("customer_email"),
    platformCustomerId: bigint("platform_customer_id", { mode: "number" }),
  },
  (table) => [
    // Index for efficient lookups
    index("cached_tools_customer_email_idx").on(table.customerEmail),
    index("cached_tools_platform_customer_id_idx").on(table.platformCustomerId),
    index("cached_tools_tool_name_idx").on(table.toolName),

    // Unique constraint to ensure one tool per name per customer context
    // This allows upsert logic (overwrite existing)
    unique("cached_tools_unique_tool_customer").on(table.toolName, table.customerEmail, table.platformCustomerId),
  ],
).enableRLS();

export const cachedToolsRelations = relations(cachedTools, ({ one }) => ({
  platformCustomer: one(platformCustomers, {
    fields: [cachedTools.platformCustomerId],
    references: [platformCustomers.id],
  }),
}));
