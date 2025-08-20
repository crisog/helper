import "server-only";
import { and, eq } from "drizzle-orm";
import { db, Transaction } from "@/db/client";
import { tools as toolsTable } from "@/db/schema";
import type { CachedTool } from "@/db/schema/cachedTools";
import type { Tool } from "@/db/schema/tools";
import { parseToolsFromOpenAPISpec } from "@/lib/tools/openApiParser";
import { getCachedToolsForCustomer } from "./cachedTools";

export const getMailboxToolsForChat = async (tx?: Transaction | typeof db): Promise<Tool[]> => {
  const dbOrTx = tx || db;
  return await dbOrTx.query.tools.findMany({
    where: and(eq(toolsTable.enabled, true), eq(toolsTable.availableInChat, true)),
  });
};

export type ToolForChat = Tool | (CachedTool & { source: "cached" });

/**
 * Get all tools available for chat including both database tools and cached tools.
 * Cached tools take priority over database tools with the same name.
 *
 * @param customerEmail - Customer email for customer-specific cached tools
 * @param tx - Optional transaction
 * @returns Combined array of database and cached tools
 */
export const getAllToolsForChat = async (
  customerEmail?: string,
  tx?: Transaction | typeof db,
): Promise<ToolForChat[]> => {
  const dbOrTx = tx || db;
  // Get database tools and cached tools in parallel
  const [databaseTools, cachedTools] = await Promise.all([
    getMailboxToolsForChat(dbOrTx),
    getCachedToolsForCustomer(customerEmail, dbOrTx),
  ]);

  const tools: ToolForChat[] = [];
  const toolNames = new Set<string>();

  // Add cached tools first (they have priority)
  for (const cachedTool of cachedTools) {
    tools.push({ ...cachedTool, source: "cached" as const });
    toolNames.add(cachedTool.toolName);
  }

  // Add database tools that don't conflict with cached tools
  for (const dbTool of databaseTools) {
    if (!toolNames.has(dbTool.name)) {
      tools.push(dbTool);
    }
  }

  return tools;
};

export const fetchOpenApiSpec = async (url: string, apiKey: string | null): Promise<string> => {
  const response = await fetch(url, {
    headers: apiKey
      ? {
          Authorization: `Bearer ${apiKey}`,
        }
      : {},
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch API spec from URL: ${response.statusText}`);
  }

  return response.text();
};

export const importToolsFromSpec = async ({
  toolApiId,
  openApiSpec,
  apiKey,
}: {
  toolApiId: number;
  openApiSpec: string;
  apiKey: string;
}) => {
  const tools = await parseToolsFromOpenAPISpec(openApiSpec, apiKey);
  const existingTools = await db.query.tools.findMany({
    where: eq(toolsTable.toolApiId, toolApiId),
  });

  const existingSlugs = new Set(existingTools.map((tool) => tool.slug));
  const toolsToUpdate = tools.filter((tool) => existingSlugs.has(tool.slug));
  const toolsToInsert = tools.filter((tool) => !existingSlugs.has(tool.slug));

  for (const tool of toolsToUpdate) {
    const existingTool = existingTools.find((t) => t.slug === tool.slug);
    await db
      .update(toolsTable)
      .set({
        ...tool,
        authenticationToken: tool.authenticationToken,
        enabled: existingTool?.enabled ?? true,
        availableInChat: existingTool?.availableInChat ?? false,
        availableInAnonymousChat: existingTool?.availableInAnonymousChat ?? false,
        updatedAt: new Date(),
      })
      .where(eq(toolsTable.slug, tool.slug));
  }

  if (toolsToInsert.length > 0) {
    await db.insert(toolsTable).values(
      toolsToInsert.map((tool) => ({
        ...tool,
        authenticationToken: tool.authenticationToken,
        toolApiId,
      })),
    );
  }

  return { toolsToUpdate, toolsToInsert };
};
