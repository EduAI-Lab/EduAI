import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  PageHeading,
  Progress,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@eduai/ui";
import { IconPlus } from "@tabler/icons-react";

import { GrantApiAccessDialog, type GrantPerson } from "~/components/admin/grant-api-access-dialog";
import type {
  ApiAccessDefaults,
  ApiAccessGrantRow,
  CreateApiAccessGrantInput,
} from "~/hooks/api/use-api-access";
import { formatUsage, usagePercent } from "~/lib/api-keys/api-access";

type ApiAccessAdminViewProps = {
  grants: ApiAccessGrantRow[];
  defaults: ApiAccessDefaults;
  includeInactive: boolean;
  onIncludeInactiveChange: (value: boolean) => void;
  isLoading: boolean;
  error: string | null;
  onCreateGrant: (input: CreateApiAccessGrantInput) => Promise<void>;
  onRevokeGrant: (grantId: string) => Promise<void>;
  /** Opens the grant dialog for this person on arrival (from the users table). */
  initialPerson?: GrantPerson | null;
};

const dateFormat = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium" });

function GrantStatus({ grant }: { grant: ApiAccessGrantRow }) {
  if (grant.active) return <Badge>Active</Badge>;
  if (grant.revokedAt) return <Badge variant="outline">Revoked</Badge>;
  return <Badge variant="secondary">Ended</Badge>;
}

function UsageCell({ used, limit }: { used: number; limit: number }) {
  return (
    <div className="min-w-28 space-y-1">
      <div className="text-xs tabular-nums">{formatUsage(used, limit)}</div>
      <Progress value={usagePercent(used, limit)} className="h-1.5" />
    </div>
  );
}

/** Admin page for API access grants (#2039): who has access, their use today, grant and revoke. */
export function ApiAccessAdminView({
  grants,
  defaults,
  includeInactive,
  onIncludeInactiveChange,
  isLoading,
  error,
  onCreateGrant,
  onRevokeGrant,
  initialPerson = null,
}: ApiAccessAdminViewProps) {
  const [dialogOpen, setDialogOpen] = useState(initialPerson !== null);
  const [dialogPerson, setDialogPerson] = useState<GrantPerson | null>(initialPerson);
  const [revoking, setRevoking] = useState<ApiAccessGrantRow | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const openDialog = () => {
    setDialogPerson(null);
    setDialogOpen(true);
  };

  const confirmRevoke = async () => {
    if (!revoking) return;
    try {
      setRevokeError(null);
      await onRevokeGrant(revoking.id);
      setRevoking(null);
    } catch (err) {
      setRevokeError(err instanceof Error ? err.message : "Could not revoke access");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeading
        heading="API Access"
        subheading="People who aren't admins can only use an API key once you give them access here."
      />

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Access grants</CardTitle>
            <CardDescription>
              Keys work only for <span className="font-mono">POST /api/completion</span> on the
              campus models, within each person's daily limits. Use is counted over the last 24
              hours.
            </CardDescription>
          </div>
          <Button onClick={openDialog} className="shrink-0">
            <IconPlus className="mr-1 h-4 w-4" /> Give API access
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Switch
              id="show-ended"
              checked={includeInactive}
              onCheckedChange={onIncludeInactiveChange}
            />
            <Label htmlFor="show-ended">Show revoked and ended</Label>
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead>Ends</TableHead>
                  <TableHead>Requests (24h)</TableHead>
                  <TableHead>Tokens (24h)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grants.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                      {isLoading ? "Loading…" : "Nobody has API access yet."}
                    </TableCell>
                  </TableRow>
                ) : (
                  grants.map((grant) => (
                    <TableRow key={grant.id}>
                      <TableCell>
                        <div className="text-sm font-medium">{grant.user.name}</div>
                        <div className="text-xs text-muted-foreground">{grant.user.email}</div>
                      </TableCell>
                      <TableCell className="max-w-64 whitespace-normal text-sm">
                        {grant.purpose}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {dateFormat.format(new Date(grant.expiresAt))}
                      </TableCell>
                      <TableCell>
                        <UsageCell
                          used={grant.usageLast24h.requests}
                          limit={grant.dailyRequestLimit}
                        />
                      </TableCell>
                      <TableCell>
                        <UsageCell used={grant.usageLast24h.tokens} limit={grant.dailyTokenLimit} />
                      </TableCell>
                      <TableCell>
                        <GrantStatus grant={grant} />
                      </TableCell>
                      <TableCell className="text-right">
                        {grant.active && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setRevoking(grant)}
                          >
                            Revoke
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <GrantApiAccessDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        defaults={defaults}
        initialPerson={dialogPerson}
        onSubmit={onCreateGrant}
      />

      <AlertDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRevoking(null);
            setRevokeError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API access?</AlertDialogTitle>
            <AlertDialogDescription>
              {revoking?.user.name}'s keys stop working at once and are disabled. To give access
              again later, grant it anew; they'll need to create a new key.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {revokeError && (
            <p className="text-sm text-destructive" role="alert">
              {revokeError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void confirmRevoke();
              }}
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
