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

type SortKey = "description" | "type" | "source" | "reporter" | "status" | "createdAt";
type SortDirection = "asc" | "desc";

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

function sortReports(rows: BugReport[], key: SortKey, direction: SortDirection) {
  const dir = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av =
      key === "description" ? a.description
      : key === "type" ? (a.bugType ?? "")
      : key === "source" ? a.source
      : key === "reporter" ? (a.isAnonymous ? "" : (a.reporterName ?? a.reporterEmail ?? ""))
      : key === "status" ? a.status
      : a.createdAt;
    const bv =
      key === "description" ? b.description
      : key === "type" ? (b.bugType ?? "")
      : key === "source" ? b.source
      : key === "reporter" ? (b.isAnonymous ? "" : (b.reporterName ?? b.reporterEmail ?? ""))
      : key === "status" ? b.status
      : b.createdAt;

    if (key === "createdAt") {
      const at = new Date(av as string).getTime();
      const bt = new Date(bv as string).getTime();
      if (at === bt) return 0;
      return at > bt ? dir : -dir;
    }
    return String(av).localeCompare(String(bv)) * dir;
  });
}

function SortHeader({
  title,
  sortKey,
  activeSortKey,
  direction,
  onToggle,
}: {
  title: string;
  sortKey: SortKey;
  activeSortKey: SortKey;
  direction: SortDirection;
  onToggle: (key: SortKey) => void;
}) {
  const isActive = sortKey === activeSortKey;
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 font-medium"
      onClick={() => onToggle(sortKey)}
    >
      <span>{title}</span>
      <span aria-hidden="true">{isActive ? (direction === "asc" ? "▲" : "▼") : "↕"}</span>
    </button>
  );
}

export function BugReportsAdminView({
  reports,
  isLoading,
  onUpdateStatus,
}: BugReportsAdminViewProps) {
  const [statusFilter, setStatusFilter] = useState<BugReportStatus | "all">("all");
  const [sourceFilter, setSourceFilter] = useState<BugReportSource | "all">("all");
  const [typeFilter, setTypeFilter] = useState<BugReportType | "all">("all");
  const [reporterFilter, setReporterFilter] = useState<"all" | "named" | "anonymous">("all");
  const [searchText, setSearchText] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const toggleSort = (nextKey: SortKey) => {
    if (sortKey === nextKey) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === "createdAt" ? "desc" : "asc");
  };

  const filteredReports = useMemo(() => {
    const filtered = reports.filter((report) => {
      if (statusFilter !== "all" && report.status !== statusFilter) return false;
      if (sourceFilter !== "all" && report.source !== sourceFilter) return false;
      if (typeFilter !== "all" && report.bugType !== typeFilter) return false;
      if (reporterFilter === "named" && report.isAnonymous) return false;
      if (reporterFilter === "anonymous" && !report.isAnonymous) return false;
      if (searchText && !report.description.toLowerCase().includes(searchText.toLowerCase())) return false;
      return true;
    });
    return sortReports(filtered, sortKey, sortDirection);
  }, [reports, statusFilter, sourceFilter, typeFilter, reporterFilter, searchText, sortKey, sortDirection]);

  const hasActiveFilters =
    statusFilter !== "all" ||
    sourceFilter !== "all" ||
    typeFilter !== "all" ||
    reporterFilter !== "all" ||
    searchText.length > 0;

  const resetFilters = () => {
    setStatusFilter("all");
    setSourceFilter("all");
    setTypeFilter("all");
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
              subheading={<>Triage platform bug reports.</>}
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

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 lg:gap-2">
                    <Select
                      value={statusFilter}
                      onValueChange={(v) => setStatusFilter(v as BugReportStatus | "all")}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All statuses</SelectItem>
                        {Object.entries(STATUS_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select
                      value={sourceFilter}
                      onValueChange={(v) => setSourceFilter(v as BugReportSource | "all")}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Source" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All sources</SelectItem>
                        {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select
                      value={typeFilter}
                      onValueChange={(v) => setTypeFilter(v as BugReportType | "all")}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All types</SelectItem>
                        {Object.entries(BUG_TYPE_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select
                      value={reporterFilter}
                      onValueChange={(v) => setReporterFilter(v as "all" | "named" | "anonymous")}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Reporter" />
                      </SelectTrigger>
                      <SelectContent>
                        {REPORTER_OPTIONS.map(({ value, label }) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

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
                        <TableHead>
                          <SortHeader title="Description" sortKey="description" activeSortKey={sortKey} direction={sortDirection} onToggle={toggleSort} />
                        </TableHead>
                        <TableHead>
                          <SortHeader title="Type" sortKey="type" activeSortKey={sortKey} direction={sortDirection} onToggle={toggleSort} />
                        </TableHead>
                        <TableHead>
                          <SortHeader title="Source" sortKey="source" activeSortKey={sortKey} direction={sortDirection} onToggle={toggleSort} />
                        </TableHead>
                        <TableHead>
                          <SortHeader title="Reporter" sortKey="reporter" activeSortKey={sortKey} direction={sortDirection} onToggle={toggleSort} />
                        </TableHead>
                        <TableHead>
                          <SortHeader title="Status" sortKey="status" activeSortKey={sortKey} direction={sortDirection} onToggle={toggleSort} />
                        </TableHead>
                        <TableHead>
                          <SortHeader title="Created" sortKey="createdAt" activeSortKey={sortKey} direction={sortDirection} onToggle={toggleSort} />
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredReports.map((report) => (
                        <TableRow key={report.id}>
                          <TableCell className="max-w-[280px]">
                            <div className="text-sm line-clamp-3 whitespace-normal">
                              {report.description}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {report.bugType ? BUG_TYPE_LABELS[report.bugType] : "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{SOURCE_LABELS[report.source]}</Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {report.isAnonymous
                              ? <span className="italic text-muted-foreground">Anonymous</span>
                              : report.reporterName || "Unknown"}
                          </TableCell>
                          <TableCell>
                            <Select
                              value={report.status}
                              onValueChange={(value) =>
                                void onUpdateStatus(report.id, value as BugReportStatus)
                              }
                            >
                              <SelectTrigger className="w-[140px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                                  <SelectItem key={value} value={value}>{label}</SelectItem>
                                ))}
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
