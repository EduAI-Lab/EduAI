import { IconEdit, IconTrash } from "@tabler/icons-react";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "~/components/ui/alert-dialog";
import { Switch } from "~/components/ui/switch";

type AIProvider = {
  id: string;
  name: string;
  displayName: string;
  description: string;
  requiresApiKey: boolean;
  defaultBaseUrl?: string;
  envVarName?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count: {
    models: number;
  };
};

export interface ProvidersTableProps {
  providers: AIProvider[];
  onEdit: (provider: AIProvider) => void;
  onDelete: (id: string) => void;
  onToggleActive: (provider: AIProvider) => void;
}

export function ProvidersTable({ providers, onEdit, onDelete, onToggleActive }: ProvidersTableProps) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Provider</TableHead>
            <TableHead>Models</TableHead>
            <TableHead>API Key Required</TableHead>
            <TableHead>Env Variable</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {providers.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                No providers found.
              </TableCell>
            </TableRow>
          )}
          {providers.map((provider) => (
            <TableRow key={provider.id}>
              <TableCell>
                <div>
                  <div className="font-medium">{provider.displayName}</div>
                  <div className="text-sm text-muted-foreground">{provider.description}</div>
                </div>
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{provider._count.models}</Badge>
              </TableCell>
              <TableCell>
                {provider.requiresApiKey ? (
                  <Badge variant="default">Required</Badge>
                ) : (
                  <Badge variant="outline">Not Required</Badge>
                )}
              </TableCell>
              <TableCell>
                {provider.envVarName ? (
                  <code className="text-xs bg-muted px-2 py-1 rounded">
                    {provider.envVarName}
                  </code>
                ) : (
                  <span className="text-muted-foreground">None</span>
                )}
              </TableCell>
              <TableCell>
                <div className="flex items-center space-x-2">
                  <Switch
                    checked={provider.isActive}
                    onCheckedChange={() => onToggleActive(provider)}
                  />
                  <span className="text-sm">
                    {provider.isActive ? "Active" : "Inactive"}
                  </span>
                </div>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onEdit(provider)}
                  >
                    <IconEdit className="h-4 w-4" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm">
                        <IconTrash className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Provider</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete "{provider.displayName}"? This will also delete all associated models.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => onDelete(provider.id)}>
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}