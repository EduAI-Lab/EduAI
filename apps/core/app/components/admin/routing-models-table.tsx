import { IconInfoCircle, IconRoute } from "@tabler/icons-react";
import {
  Badge,
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
import type {
  RoutingModelSettingKey,
  RoutingModelSettings,
} from "~/lib/routing-model-settings";

type RoutingModelsTableProps = {
  definitions: RoutingModelSettingDefinition[];
  settings: RoutingModelSettings;
  onToggle: (key: RoutingModelSettingKey, value: boolean) => Promise<void>;
};

export function RoutingModelsTable({
  definitions,
  settings,
  onToggle,
}: RoutingModelsTableProps) {
  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold">Automatic routing</h3>
        <p className="text-sm text-muted-foreground">
          Control which automatic model-selection modes appear in chat.
        </p>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Model</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
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
                    <div className="mt-1 text-sm text-muted-foreground">
                      {definition.id}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">Routing</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">CHAT</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center space-x-2">
                      <Switch
                        aria-label={`${enabled ? "Disable" : "Enable"} ${definition.name}`}
                        checked={enabled}
                        onCheckedChange={(checked) =>
                          void onToggle(definition.key, checked)
                        }
                      />
                      <span className="text-sm">
                        {enabled ? "Active" : "Inactive"}
                      </span>
                    </div>
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
