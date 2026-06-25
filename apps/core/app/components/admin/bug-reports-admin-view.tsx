"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Input } from "@eduai/ui";
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
import { IconFilter, IconSearch, IconX } from "@tabler/icons-react";
import type { BugReport, BugReportStatus, BugReportSource, BugReportType } from "~/hooks/api/types";

export type BugReportsAdminViewProps = {
  reports: BugReport[];
  isLoading: boolean;
  onUpdateStatus: (id: string, status: BugReportStatus) => Promise<void>;
};

const STATUS_LABELS: Record<BugReportStatus, string> = {
  UNHANDLED: "Unhandled",
  IN_PROGRESS: "In progress",
  RESOLVED: "Resolved",
};

const SOURCE_LABELS: Record<BugReportSource, string> = {
  CORE: "Core",
  AI_TUTOR: "AI Tutor",
  QUESTION_MAKER: "Question Maker",
};

const BUG_TYPE_LABELS: Record<BugReportType, string> = {
  UI_DISPLAY: "UI / display",
  FEATURE_NOT_WORKING: "Feature not working",
  PERFORMANCE: "Performance",
  CONTENT_ERROR: "Content error",
  ACCESS_PERMISSION: "Access / permission",
  OTHER: "Other",
};

const REPORTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "named", label: "Named" },
  { value: "anonymous", label: "Anonymous" },
];

export function BugReportsAdminView({
  reports,
  isLoading,
  onUpdateStatus,
}: BugReportsAdminViewProps) {
  // Filter state
  const [statusFilter, setStatusFilter] = useState<BugReportStatus | "all">("all");
  const [sourceFilter, setSourceFilter] = useState<BugReportSource | "all">("all");
  const [reporterFilter, setReporterFilter] = useState<"all" | "named" | "anonymous">("all");
  const [searchText, setSearchText] = useState("");

  // Compute filtered reports
  const filteredReports = useMemo(() => {
    return reports.filter((report) => {
      // Status filter
      if (statusFilter !== "all" && report.status !== statusFilter) {
        return false;
      }

      // Source filter
      if (sourceFilter !== "all" && report.source !== sourceFilter) {
        return false;
      }

      // Reporter filter
      if (reporterFilter === "named" && report.isAnonymous) {
        return false;
      }
      if (reporterFilter === "anonymous" && !report.isAnonymous) {
        return false;
      }

      // Text search (description)
      if (
        searchText &&
        !report.description.toLowerCase().includes(searchText.toLowerCase())
      ) {
        return false;
      }

      return true;
    });
  }, [reports, statusFilter, sourceFilter, reporterFilter, searchText]);

  // Check if any filter is active
  const hasActiveFilters =
    statusFilter !== "all" ||
    sourceFilter !== "all" ||
    reporterFilter !== "all" ||
    searchText.length > 0;

  // Reset all filters
  const resetFilters = () => {
    setStatusFilter("all");
    setSourceFilter("all");
    setReporterFilter("all");
    setSearchText("");
  };

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
                  Triage platform bug reports.
                </>
              }
            />
          </div>

          <div className="px-4 lg:px-6">
            <Card>
              <CardHeader>
                <CardTitle>All reports</CardTitle>
                <CardDescription>
                  Filter and update status for incoming reports.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Filter Bar */}
                <div className="flex flex-col gap-3 pb-4">
                  <div className="flex items-center gap-2">
                    <IconFilter className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-muted-foreground">
                      Filters
                    </span>
                  </div>

                  {/* Filter Controls Grid */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-2">
                    {/* Status Filter */}
                    <Select
                      value={statusFilter}
                      onValueChange={(value) =>
                        setStatusFilter(value as BugReportStatus | "all")
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All statuses</SelectItem>
                        {Object.entries(STATUS_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {/* Source Filter */}
                    <Select
                      value={sourceFilter}
                      onValueChange={(value) =>
                        setSourceFilter(value as BugReportSource | "all")
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Source" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All sources</SelectItem>
                        {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {/* Reporter Filter */}
                    <Select
                      value={reporterFilter}
                      onValueChange={(value) =>
                        setReporterFilter(
                          value as "all" | "named" | "anonymous",
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Reporter" />
                      </SelectTrigger>
                      <SelectContent>
                        {REPORTER_OPTIONS.map(({ value, label }) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {/* Text Search Input */}
                    <div className="relative">
                      <IconSearch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="Search description..."
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                        className="pl-9"
                      />
                    </div>
                  </div>

                  {/* Clear Filters Button */}
                  {hasActiveFilters && (
                    <div className="flex items-center justify-between pt-2">
                      <span className="text-sm text-muted-foreground">
                        Showing {filteredReports.length} of {reports.length} reports
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={resetFilters}
                        className="text-destructive hover:text-destructive"
                      >
                        <IconX className="h-4 w-4" />
                        Clear filters
                      </Button>
                    </div>
                  )}
                </div>

                {/* Table or Empty State */}
                {filteredReports.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <p className="text-sm text-muted-foreground">
                      {hasActiveFilters
                        ? "No reports match your filters. Try adjusting your search criteria."
                        : "No bug reports yet."}
                    </p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Description</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Reporter</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredReports.map((report) => (
                        <TableRow key={report.id}>
                          <TableCell>
                            <div className="text-sm line-clamp-3">
                              {report.description}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {report.bugType ? BUG_TYPE_LABELS[report.bugType] : "—"}
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
