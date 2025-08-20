"use client";

import { Check, RefreshCw, Trash } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmationDialog } from "@/components/confirmationDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { RouterOutputs } from "@/trpc";
import { api } from "@/trpc/react";
import ToolListItem from "./toolListItem";

const ApiCard = ({ api: apiData }: { api: RouterOutputs["mailbox"]["tools"]["listWithCached"][number] }) => {
  const utils = api.useUtils();
  
  // Helper function to get badge info based on API type
  const getBadgeInfo = () => {
    if (apiData.id === -1) {
      return { label: "Global Cached", variant: "bright" as const };
    } else if (apiData.id === -2) {
      return { label: "Customer Cached", variant: "gray" as const };
    } else {
      return { label: "Database API", variant: "default" as const };
    }
  };

  const badgeInfo = getBadgeInfo();
  const [isRefreshed, setIsRefreshed] = useState(false);
  const [isSchemaPopoverOpen, setIsSchemaPopoverOpen] = useState(false);
  const [schema, setSchema] = useState("");

  const { mutate: refreshApi, isPending: isRefreshing } = api.mailbox.tools.refreshApi.useMutation({
    onSuccess: () => {
      setIsRefreshed(true);
      setTimeout(() => setIsRefreshed(false), 3000);
      utils.mailbox.tools.listWithCached.invalidate();
      setIsSchemaPopoverOpen(false);
      setSchema("");
    },
    onError: (error) => {
      toast.error("Error refreshing API", { description: error.message });
    },
  });

  const { mutate: deleteApi, isPending: isDeleting } = api.mailbox.tools.deleteApi.useMutation({
    onSuccess: () => {
      utils.mailbox.tools.listWithCached.invalidate();
    },
    onError: (error) => {
      toast.error("Error deleting API", { description: error.message });
    },
  });

  const handleSchemaSubmit = () => {
    refreshApi({ apiId: apiData.id, schema });
  };

  const refreshButton = (ariaAttributes: React.AriaAttributes) => (
    <Button variant="ghost" size="sm" disabled={isRefreshing} {...ariaAttributes}>
      {isRefreshed ? (
        <Check className="h-4 w-4 mr-2" />
      ) : (
        <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`} />
      )}
      {isRefreshed ? "Refreshed" : "Refresh"}
    </Button>
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle>{apiData.name}</CardTitle>
              <Badge variant={badgeInfo.variant}>{badgeInfo.label}</Badge>
            </div>
            <div className="text-sm text-muted-foreground">{apiData.baseUrl ?? "OpenAPI schema"}</div>
          </div>
          <div className="flex gap-2">
            {/* Only show refresh/delete actions for database APIs, not cached tools */}
            {apiData.id > 0 && !apiData.baseUrl ? (
              <Popover open={isSchemaPopoverOpen} onOpenChange={setIsSchemaPopoverOpen}>
                <PopoverTrigger asChild>{refreshButton({})}</PopoverTrigger>
                <PopoverContent className="min-w-[400px]">
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="schema">Update OpenAPI Schema</Label>
                      <Textarea
                        id="schema"
                        value={schema}
                        onChange={(e) => setSchema(e.target.value)}
                        onModEnter={handleSchemaSubmit}
                        placeholder={`{
  "products": {
    "GET": {
      "url": "/products/:id",
      "description": "Retrieve the details of a product"
    }
  }
}`}
                        rows={10}
                        disabled={isRefreshing}
                        className="mt-2"
                      />
                    </div>
                    <div className="flex justify-end">
                      <Button type="submit" disabled={isRefreshing} onClick={handleSchemaSubmit}>
                        {isRefreshing ? "Updating..." : "Update Schema"}
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            ) : apiData.id > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => refreshApi({ apiId: apiData.id })}
                disabled={isRefreshing}
              >
                {isRefreshed ? (
                  <Check className="h-4 w-4 mr-2" />
                ) : (
                  <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`} />
                )}
                {isRefreshed ? "Refreshed" : "Refresh"}
              </Button>
            ) : null}
            {apiData.id > 0 && (
              <ConfirmationDialog
              message="Are you sure you want to delete this API?"
              onConfirm={() => {
                deleteApi({ apiId: apiData.id });
              }}
              confirmLabel="Yes, delete"
            >
              <Button variant="ghost" size="sm" iconOnly disabled={isDeleting}>
                <Trash className="h-4 w-4" />
              </Button>
            </ConfirmationDialog>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-border">
          {apiData.tools.map((tool) => (
            <ToolListItem key={tool.id} tool={tool} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default ApiCard;
