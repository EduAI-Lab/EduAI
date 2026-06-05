import { Badge } from "~/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import type { BugReport, BugReportStatus } from "~/hooks/api/types";

export type BugReportsAdminViewProps = {
  reports: BugReport[];
  isLoading: boolean;
  isStubbed: boolean;
  onUpdateStatus: (id: string, status: BugReportStatus) => Promise<void>;
};

const STATUS_LABELS: Record<BugReportStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

export function BugReportsAdminView({
  reports,
  isLoading,
  isStubbed,
  onUpdateStatus,
}: BugReportsAdminViewProps) {
  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
        <p className="mt-4 text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
          <div className="px-4 lg:px-6">
            <h2 className="text-2xl font-bold">Bug Reports</h2>
            <p className="text-muted-foreground">
              Triage platform bug reports (ADMIN only, §11).
              {isStubbed && " Stub data until Core API #304."}
            </p>
          </div>

          <div className="px-4 lg:px-6">
            <Card>
              <CardHeader>
                <CardTitle>All reports</CardTitle>
                <CardDescription>
                  Filter and update status for incoming reports.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Reporter</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reports.map((report) => (
                      <TableRow key={report.id}>
                        <TableCell>
                          <div className="font-medium">{report.title}</div>
                          <div className="text-xs text-muted-foreground line-clamp-2">
                            {report.description}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{report.source}</Badge>
                        </TableCell>
                        <TableCell>
                          {report.isAnonymous
                            ? "Anonymous"
                            : report.reporterName || "Unknown"}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={report.status}
                            onValueChange={(value) =>
                              void onUpdateStatus(
                                report.id,
                                value as BugReportStatus,
                              )
                            }
                          >
                            <SelectTrigger className="w-[140px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(STATUS_LABELS).map(
                                ([value, label]) => (
                                  <SelectItem key={value} value={value}>
                                    {label}
                                  </SelectItem>
                                ),
                              )}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(report.createdAt).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
