import { IconEdit, IconInfoCircle, IconRoute } from "@tabler/icons-react";
import {
  Button,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@eduai/ui";

import type { RoutingModelSettingDefinition } from "~/hooks/api/use-routing-model-settings";
import type { RoutingModelSettingKey, RoutingModelSettings } from "~/lib/routing-model-settings";

type RoutingModelsTableProps = {
  definitions: RoutingModelSettingDefinition[];
  settings: RoutingModelSettings;
  assistModelId: string | null;
  assistModelName: string | null;
  onToggle: (key: RoutingModelSettingKey, value: boolean) => Promise<void>;
  onEdit: () => void;
  onEditAssist: () => void;
};

export function RoutingModelsTable({
  definitions,
  settings,
  assistModelId,
  assistModelName,
  onToggle,
  onEdit,
  onEditAssist,
}: RoutingModelsTableProps) {
  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold">Automatic routing</h3>
        <p className="text-sm text-muted-foreground">
          Auto chooses from the models assigned below based on the request. Use Edit to manage the
          Small and Large model groups.
        </p>
      </div>
      <div className="grid gap-3 text-sm md:grid-cols-3">
        <div className="rounded-md border bg-muted/30 p-3">
          <p className="font-medium">Small tier</p>
          <p className="mt-1 text-muted-foreground">
            Faster and more efficient for straightforward questions.
          </p>
        </div>
        <div className="rounded-md border bg-muted/30 p-3">
          <p className="font-medium">Large tier</p>
          <p className="mt-1 text-muted-foreground">
            More capable for complex reasoning, coding, and long context.
          </p>
        </div>
        <div className="rounded-md border bg-muted/30 p-3">
          <p className="font-medium">How Auto works</p>
          <p className="mt-1 text-muted-foreground">
            It estimates what each request needs and selects the best available group.
          </p>
        </div>
      </div>
      <div className="rounded-md border p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <IconRoute className="mt-0.5 h-4 w-4 text-muted-foreground" />
            <div>
              <p className="font-medium">AI Assist model</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Used when Assistive mode is enabled. When configured, Auto uses this model; an
                explicitly selected chat model remains in control.
              </p>
              <p className="mt-2 text-sm">
                <span className="text-muted-foreground">Current:</span>{" "}
                <span className="font-medium">
                  {assistModelName ?? (assistModelId ? assistModelId : "Use selected chat model")}
                </span>
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onEditAssist}
            aria-label="Edit Assist model"
          >
            <IconEdit className="mr-2 h-4 w-4" />
            Edit Assist model
          </Button>
        </div>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Mode</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {definitions.map((definition) => {
              const enabled = settings[definition.key];
              return (
                <TableRow key={definition.key}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <IconRoute className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{definition.name}</span>
                      <TooltipProvider delayDuration={200}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              aria-label={`About ${definition.name}`}
                              aria-description={definition.description}
                              className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <IconInfoCircle className="h-4 w-4" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            {definition.description}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground">{definition.description}</span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center space-x-2">
                      <Switch
                        aria-label={`${enabled ? "Disable" : "Enable"} ${definition.name}`}
                        checked={enabled}
                        onCheckedChange={(checked) => void onToggle(definition.key, checked)}
                      />
                      <span className="text-sm">{enabled ? "Active" : "Inactive"}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={onEdit}
                      aria-label={`Edit ${definition.name} models`}
                    >
                      <IconEdit className="mr-2 h-4 w-4" />
                      Edit Auto models
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
