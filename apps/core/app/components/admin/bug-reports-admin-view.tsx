import { Badge } from "@eduai/ui";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeading,
} from "@eduai/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@eduai/ui";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@eduai/ui";
import type { BugReport, BugReportSource, BugReportStatus } from "~/hooks/api/types";

export type BugReportSourceFilter = BugReportSource | "ALL";

export type BugReportsAdminViewProps = {
  reports: BugReport[];
  isLoading: boolean;
  sourceFilter: BugReportSourceFilter;
  onSourceFilterChange: (value: BugReportSourceFilter) => void;
  onUpdateStatus: (id: string, status: BugReportStatus) => Promise<void>;
};

const STATUS_LABELS: Record<BugReportStatus, string> = {
  UNHANDLED: "Unhandled",
  IN_PROGRESS: "In progress",
  RESOLVED: "Resolved",
};

const SOURCE_FILTER_LABELS: Record<BugReportSourceFilter, string> = {
  ALL: "All sources",
  CORE: "Core",
  QUESTION_MAKER: "Question Maker",
  AI_TUTOR: "AI Tutor",
};

export function BugReportsAdminView({
  reports,
  isLoading,
  sourceFilter,
  onSourceFilterChange,
  onUpdateStatus,
}: BugReportsAdminViewProps) {
  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
        <p className="mt-4 text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
          <div className="px-4 lg:px-6">
            <PageHeading
              heading="Bug reports"
              subheading={
                <>
                  Single triage surface for Core and all extensions (ADMIN only, §11).
                  Filter by source to review Question Maker, AI Tutor, or Core reports.
                </>
              }
            />
          </div>

          <div className="px-4 lg:px-6">
            <Card>
              <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>All reports</CardTitle>
                  <CardDescription>
                    Update status for incoming reports from any app.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground whitespace-nowrap">Source</span>
                  <Select
                    value={sourceFilter}
                    onValueChange={(value) =>
                      onSourceFilterChange(value as BugReportSourceFilter)
                    }
                  >
                    <SelectTrigger className="w-[180px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(SOURCE_FILTER_LABELS) as BugReportSourceFilter[]).map(
                        (key) => (
                          <SelectItem key={key} value={key}>
                            {SOURCE_FILTER_LABELS[key]}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                {reports.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No bug reports
                    {sourceFilter === "ALL" ? "" : ` for ${SOURCE_FILTER_LABELS[sourceFilter]}`}.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Description</TableHead>
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
                            <div className="text-sm line-clamp-3">
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
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
