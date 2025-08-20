import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db, Transaction } from "@/db/client";
import { cachedTools, platformCustomers } from "@/db/schema";
import type { CachedTool } from "@/db/schema/cachedTools";
import type { WidgetSessionPayload } from "@/lib/widgetSession";
import type { ToolRequestBody } from "@/packages/client/dist";
import { captureExceptionAndLog } from "../shared/sentry";
import { getPlatformCustomer } from "./platformCustomer";

export type CachedToolsForChat = CachedTool[];

export interface CacheToolsParams {
  tools: Record<string, ToolRequestBody>;
  customerSpecificTools: boolean;
  session: WidgetSessionPayload;
  tx?: Transaction | typeof db;
}

/**
 * Cache tools provided via API endpoints.
 * Only tools with serverRequestUrl are cached (client-side tools are filtered out).
 *
 * @param params - Caching parameters
 * @returns Array of cached tool names
 */
export const cacheTools = async ({
  tools,
  customerSpecificTools,
  session,
  tx,
}: CacheToolsParams): Promise<string[]> => {
  const dbOrTx = tx || db;
  if (!tools || Object.keys(tools).length === 0) {
    return [];
  }

  // Filter tools that have serverRequestUrl (only these can be cached)
  const toolsWithServerUrl = Object.entries(tools).filter(([, tool]) => tool.serverRequestUrl);

  if (toolsWithServerUrl.length === 0) {
    return [];
  }

  // Determine customer context
  let customerEmail: string | null = null;
  let platformCustomerId: number | null = null;

  if (customerSpecificTools && !session.isAnonymous && session.email) {
    customerEmail = session.email;

    // Try to get platform customer ID for better referential integrity
    try {
      const platformCustomer = await getPlatformCustomer(session.email);
      if (platformCustomer) {
        platformCustomerId = platformCustomer.id;
      }
    } catch (error) {
      captureExceptionAndLog(error, {
        extra: { email: session.email },
      });
    }
  }

  const cachedToolNames: string[] = [];

  // Cache each tool (upsert logic - overwrite if exists)
  for (const [toolName, tool] of toolsWithServerUrl) {
    try {
      // First, try to find existing tool
      const existingToolResult = await dbOrTx
        .select()
        .from(cachedTools)
        .where(
          and(
            eq(cachedTools.toolName, toolName),
            customerEmail ? eq(cachedTools.customerEmail, customerEmail) : isNull(cachedTools.customerEmail),
            platformCustomerId
              ? eq(cachedTools.platformCustomerId, platformCustomerId)
              : isNull(cachedTools.platformCustomerId),
          ),
        )
        .limit(1);
      const existingTool = existingToolResult[0];

      if (existingTool) {
        // Update existing tool
        await dbOrTx
          .update(cachedTools)
          .set({
            description: tool.description || null,
            parameters: tool.parameters || {},
            serverRequestUrl: tool.serverRequestUrl!,
            updatedAt: new Date(),
          })
          .where(eq(cachedTools.id, existingTool.id));
      } else {
        // Insert new tool
        await dbOrTx.insert(cachedTools).values({
          toolName,
          description: tool.description || null,
          parameters: tool.parameters || {},
          serverRequestUrl: tool.serverRequestUrl!,
          customerEmail,
          platformCustomerId,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      cachedToolNames.push(toolName);
    } catch (error) {
      captureExceptionAndLog(error, {
        extra: { toolName, customerEmail, platformCustomerId },
      });
    }
  }

  return cachedToolNames;
};

/**
 * Get cached tools for a specific customer context.
 * Priority: Customer-specific → Global
 *
 * @param customerEmail - Customer email for customer-specific tools
 * @param tx - Optional transaction
 * @returns Array of cached tools
 */
export const getCachedToolsForCustomer = async (
  customerEmail?: string,
  tx?: Transaction | typeof db,
): Promise<CachedToolsForChat> => {
  const dbOrTx = tx || db;
  const tools: CachedTool[] = [];

  // First, get customer-specific tools if customer email is provided
  if (customerEmail) {
    const customerTools = await dbOrTx.query.cachedTools.findMany({
      where: eq(cachedTools.customerEmail, customerEmail),
    });
    tools.push(...customerTools);
  }

  // Then, get global tools (those without customer context)
  const globalTools = await dbOrTx.query.cachedTools.findMany({
    where: and(isNull(cachedTools.customerEmail), isNull(cachedTools.platformCustomerId)),
  });

  // Add global tools that don't conflict with customer-specific tools
  const existingToolNames = new Set(tools.map((tool) => tool.toolName));
  for (const globalTool of globalTools) {
    if (!existingToolNames.has(globalTool.toolName)) {
      tools.push(globalTool);
    }
  }

  return tools;
};

/**
 * Get all cached tools for the admin UI.
 * Groups tools by their context (customer-specific vs global).
 *
 * @param tx - Optional transaction
 * @returns Object with customer and global tool arrays
 */
export const getAllCachedToolsForUI = async (
  tx?: Transaction | typeof db,
): Promise<{
  customerSpecificTools: (CachedTool & { customerInfo?: { email: string; name?: string } })[];
  globalTools: CachedTool[];
}> => {
  const dbOrTx = tx || db;
  // Get all cached tools with customer information
  const allTools = await dbOrTx
    .select()
    .from(cachedTools)
    .leftJoin(platformCustomers, eq(cachedTools.platformCustomerId, platformCustomers.id))
    .orderBy(cachedTools.toolName, cachedTools.customerEmail);

  const customerSpecificTools = allTools
    .filter((row) => row.cached_tools.customerEmail || row.cached_tools.platformCustomerId)
    .map((row) => ({
      ...row.cached_tools,
      customerInfo: {
        email: row.cached_tools.customerEmail || row.mailboxes_platformcustomer?.email || "Unknown",
        name: row.mailboxes_platformcustomer?.name || undefined,
      },
    }));

  const globalTools = allTools
    .filter((row) => !row.cached_tools.customerEmail && !row.cached_tools.platformCustomerId)
    .map((row) => row.cached_tools);

  return {
    customerSpecificTools,
    globalTools,
  };
};

/**
 * Delete cached tools for a specific customer.
 * Useful for cleanup when customers are removed.
 *
 * @param customerEmail - Customer email
 * @param tx - Optional transaction
 * @returns Number of deleted tools
 */
export const deleteCachedToolsForCustomer = async (
  customerEmail: string,
  tx?: Transaction | typeof db,
): Promise<number> => {
  const dbOrTx = tx || db;
  const result = await dbOrTx
    .delete(cachedTools)
    .where(eq(cachedTools.customerEmail, customerEmail))
    .returning({ id: cachedTools.id });

  return result.length;
};

/**
 * Delete a specific cached tool.
 *
 * @param toolName - Tool name
 * @param customerEmail - Customer email (optional for global tools)
 * @param tx - Optional transaction
 * @returns Whether the tool was deleted
 */
export const deleteCachedTool = async (
  toolName: string,
  customerEmail?: string,
  tx?: Transaction | typeof db,
): Promise<boolean> => {
  const dbOrTx = tx || db;
  const whereCondition = customerEmail
    ? and(eq(cachedTools.toolName, toolName), eq(cachedTools.customerEmail, customerEmail))
    : and(
        eq(cachedTools.toolName, toolName),
        isNull(cachedTools.customerEmail),
        isNull(cachedTools.platformCustomerId),
      );

  const result = await dbOrTx.delete(cachedTools).where(whereCondition).returning({ id: cachedTools.id });

  return result.length > 0;
};
