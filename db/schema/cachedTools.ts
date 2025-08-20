import { relations, sql } from "drizzle-orm";
import { bigint, index, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
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
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    toolName: text("tool_name").notNull(),
    description: text("description"),
    parameters: jsonb("parameters").$type<CachedToolParameters>().default({}).notNull(),
    serverRequestUrl: text("server_request_url").notNull(),
    customerEmail: text("customer_email"),
    platformCustomerId: bigint("platform_customer_id", { mode: "number" }).references(() => platformCustomers.id),
  },
  (table) => ({
    // Index for efficient lookups
    cached_tools_tool_name_idx: index("cached_tools_tool_name_idx").on(table.toolName),

    // Partial unique index for global tools (no customer context)
    // Ensures only one global tool per tool name
    cached_tools_unique_global_tool: uniqueIndex("cached_tools_unique_global_tool")
      .on(table.toolName)
      .where(sql`${table.customerEmail} IS NULL AND ${table.platformCustomerId} IS NULL`),
    
    // Partial unique index for customer-specific tools (by email)
    // Ensures only one tool per name per customer email
    cached_tools_unique_customer_email_tool: uniqueIndex("cached_tools_unique_customer_email_tool")
      .on(table.toolName, table.customerEmail)
      .where(sql`${table.customerEmail} IS NOT NULL`),
    
    // Partial unique index for customer-specific tools (by platform customer ID)
    // Ensures only one tool per name per platform customer ID
    cached_tools_unique_platform_customer_tool: uniqueIndex("cached_tools_unique_platform_customer_tool")
      .on(table.toolName, table.platformCustomerId)
      .where(sql`${table.platformCustomerId} IS NOT NULL`),
  }),
).enableRLS();

export const cachedToolsRelations = relations(cachedTools, ({ one }) => ({
  platformCustomer: one(platformCustomers, {
    fields: [cachedTools.platformCustomerId],
    references: [platformCustomers.id],
  }),
}));
