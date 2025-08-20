import type { Tool } from "@/db/schema/tools";

export type ToolFormatted = Omit<
  Tool,
  "authenticationToken" | "unused_authenticationToken" | "authenticationMethod" | "createdAt" | "updatedAt" | "headers"
> & {
  path: string;
  source?: string; // Added to indicate tool source (database, cached-global, cached-customer)
  customerInfo?: { email: string; name?: string }; // For customer-specific cached tools
};
