/**
 * Admin-only list of bug reports with status updates and attachment viewers.
 */
import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { IconFilter, IconSearch, IconX } from '@tabler/icons-react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  PageHeading,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@eduai/ui';
import { bugReportApi, BugReportRow, BugReportType } from '../services/bugReportApi';
import { useAuth } from '../contexts/AuthContext';
import { canTriageBugReports } from '@/lib/rbac';
import { toast } from 'sonner';

const STATUS_OPTIONS = ['unhandled', 'in progress', 'resolved'] as const;
type BugReportStatus = (typeof STATUS_OPTIONS)[number] | 'all';
type TypeFilter = BugReportType | 'all';
type ReporterFilter = 'all' | 'named' | 'anonymous';
type SortKey = 'status' | 'type' | 'description' | 'reporter' | 'createdAt' | 'page';
type SortDirection = 'asc' | 'desc';

const QM_SOURCE = 'QUESTION_MAKER' as const;

const STATUS_LABELS: Record<string, string> = {
  unhandled: 'Unhandled',
  'in progress': 'In progress',
  resolved: 'Resolved',
};

const BUG_TYPE_LABELS: Record<BugReportType, string> = {
  UI_DISPLAY: 'UI / display',
  FEATURE_NOT_WORKING: 'Feature not working',
  PERFORMANCE: 'Performance',
  CONTENT_ERROR: 'Content error',
  ACCESS_PERMISSION: 'Access / permission',
  OTHER: 'Other',
};

function getPagePath(pageUrl: string | null | undefined) {
  if (!pageUrl) return '';
  try {
    return new URL(pageUrl).pathname;
  } catch {
    return pageUrl;
  }
}

function sortRows(rows: BugReportRow[], key: SortKey, direction: SortDirection) {
  const dir = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av =
      key === 'status' ? a.status
      : key === 'type' ? (a.bugType ?? '')
      : key === 'description' ? a.description
      : key === 'reporter' ? (a.isAnonymous ? '' : (a.user?.email ?? ''))
      : key === 'page' ? getPagePath(a.pageUrl)
      : a.createdAt;
    const bv =
      key === 'status' ? b.status
      : key === 'type' ? (b.bugType ?? '')
      : key === 'description' ? b.description
      : key === 'reporter' ? (b.isAnonymous ? '' : (b.user?.email ?? ''))
      : key === 'page' ? getPagePath(b.pageUrl)
      : b.createdAt;

    if (key === 'createdAt') {
      const at = new Date(av).getTime();
      const bt = new Date(bv).getTime();
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
      className="inline-flex items-center gap-1 font-medium text-left"
      onClick={() => onToggle(sortKey)}
    >
      <span>{title}</span>
      <span aria-hidden="true">{isActive ? (direction === 'asc' ? '▲' : '▼') : '↕'}</span>
    </button>
  );
}

function DetailDialog({
  open,
  onClose,
  title,
  content,
  type
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  content: string;
  type: 'logs' | 'screenshot' | 'plain';
}) {
  const isEmpty = !content || content === '[]' || content === '{}';

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] p-6">
        <DialogHeader className="pb-4">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <p className="text-sm font-medium">No data captured</p>
          </div>
        ) : type === 'screenshot' ? (
          <img src={content} alt="Bug report screenshot" className="w-full rounded-md border" />
        ) : type === 'plain' ? (
          <pre className="text-sm bg-muted border rounded-md p-4 overflow-auto max-h-[60vh] whitespace-pre-wrap break-words leading-relaxed">
            {content}
          </pre>
        ) : (
          <pre className="text-xs bg-muted border rounded-md p-4 overflow-auto max-h-[60vh] whitespace-pre-wrap break-words font-mono leading-relaxed">
            {(() => {
              try {
                return JSON.stringify(JSON.parse(content), null, 2);
              } catch {
                return content;
              }
            })()}
          </pre>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function BugReportsAdminPage() {
  const navigate = useNavigate();
  const { user, isLoading } = useAuth();
  const [rows, setRows] = useState<BugReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<{
    open: boolean;
    title: string;
    content: string;
    type: 'logs' | 'screenshot' | 'plain';
  }>({ open: false, title: '', content: '', type: 'logs' });
  const [statusFilter, setStatusFilter] = useState<BugReportStatus>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [reporterFilter, setReporterFilter] = useState<ReporterFilter>('all');
  const [searchText, setSearchText] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await bugReportApi.list({ source: QM_SOURCE });
      setRows(data);
    } catch {
      toast.error('Could not load bug reports', { description: 'You may not have admin access.' });
      navigate('/home');
    } finally {
      setLoading(false);
    }
  }, [navigate, toast]);

  useEffect(() => {
    if (isLoading) return;
    const qmUser = user ? { id: user.id, role: user.role, authorizedUnits: user.authorizedUnits } : null;
    if (!canTriageBugReports(qmUser)) {
      navigate('/home', { replace: true });
      return;
    }
    void load();
  }, [isLoading, user, navigate, load]);

  const toggleSort = (nextKey: SortKey) => {
    if (sortKey === nextKey) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === 'createdAt' ? 'desc' : 'asc');
  };

  const filteredSortedRows = useMemo(() => {
    const filtered = rows.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (typeFilter !== 'all' && row.bugType !== typeFilter) return false;
      if (reporterFilter === 'named' && row.isAnonymous) return false;
      if (reporterFilter === 'anonymous' && !row.isAnonymous) return false;
      if (searchText && !row.description.toLowerCase().includes(searchText.toLowerCase())) return false;
      return true;
    });
    return sortRows(filtered, sortKey, sortDirection);
  }, [rows, statusFilter, typeFilter, reporterFilter, searchText, sortKey, sortDirection]);

  const hasActiveFilters =
    statusFilter !== 'all' || typeFilter !== 'all' || reporterFilter !== 'all' || searchText.length > 0;

  const resetFilters = () => {
    setStatusFilter('all');
    setTypeFilter('all');
    setReporterFilter('all');
    setSearchText('');
  };

  async function handleStatusChange(bugId: string, newStatus: string) {
    try {
      await bugReportApi.updateStatus(bugId, newStatus);
      setRows((prev) => prev.map((b) => (b.id === bugId ? { ...b, status: newStatus } : b)));
    } catch {
      toast.error('Failed to update status', { description: 'Please try again.' });
    }
  }

  if (isLoading) return null;
  const qmUser = user ? { id: user.id, role: user.role, authorizedUnits: user.authorizedUnits } : null;
  if (!canTriageBugReports(qmUser)) return null;

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-4 md:py-6 lg:px-6">
      <PageHeading heading="Bug reports" subheading="Triage Question Maker bug reports." />

      <Card>
        <CardHeader>
          <CardTitle>All reports</CardTitle>
          <CardDescription>Filter and update status for incoming reports.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filter bar */}
          <div className="flex flex-col gap-3 pb-4">
            <div className="flex items-center gap-2">
              <IconFilter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-muted-foreground">Filters</span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as BugReportStatus)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>{STATUS_LABELS[s] ?? s}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={typeFilter}
              onValueChange={(v) => setTypeFilter(v as TypeFilter)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {(Object.entries(BUG_TYPE_LABELS) as [BugReportType, string][]).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={reporterFilter}
              onValueChange={(v) => setReporterFilter(v as ReporterFilter)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Reporter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All reporters</SelectItem>
                <SelectItem value="named">Named</SelectItem>
                <SelectItem value="anonymous">Anonymous</SelectItem>
              </SelectContent>
            </Select>

            <div className="relative">
              <IconSearch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search description…"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          {hasActiveFilters && (
            <div className="flex items-center justify-between pt-1">
              <span className="text-sm text-muted-foreground">
                Showing {filteredSortedRows.length} of {rows.length} reports
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={resetFilters}
                className="text-destructive hover:text-destructive gap-1"
              >
                <IconX className="h-4 w-4" />
                Clear filters
              </Button>
            </div>
          )}
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border rounded-md">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="text-left p-3">
                    <SortHeader title="Status" sortKey="status" activeSortKey={sortKey} direction={sortDirection} onToggle={toggleSort} />
                  </th>
                  <th className="text-left p-3">
                    <SortHeader title="Type" sortKey="type" activeSortKey={sortKey} direction={sortDirection} onToggle={toggleSort} />
                  </th>
                  <th className="text-left p-3">
                    <SortHeader title="Description" sortKey="description" activeSortKey={sortKey} direction={sortDirection} onToggle={toggleSort} />
                  </th>
                  <th className="text-left p-3">
                    <SortHeader title="User" sortKey="reporter" activeSortKey={sortKey} direction={sortDirection} onToggle={toggleSort} />
                  </th>
                  <th className="text-left p-3">
                    <SortHeader title="Date" sortKey="createdAt" activeSortKey={sortKey} direction={sortDirection} onToggle={toggleSort} />
                  </th>
                  <th className="text-left p-3">
                    <SortHeader title="Page" sortKey="page" activeSortKey={sortKey} direction={sortDirection} onToggle={toggleSort} />
                  </th>
                  <th className="text-left p-3 font-medium">Attachments</th>
                </tr>
              </thead>
              <tbody>
                {filteredSortedRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">
                      {hasActiveFilters
                        ? 'No reports match your filters. Try adjusting your search criteria.'
                        : 'No bug reports.'}
                    </td>
                  </tr>
                ) : (
                  filteredSortedRows.map((row) => (
                    <tr key={row.id} className="border-t hover:bg-muted/20">
                      <td className="p-3 align-top">
                        <Select
                          value={row.status}
                          onValueChange={(v) => handleStatusChange(row.id, v)}
                        >
                          <SelectTrigger className="h-8 w-[130px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {STATUS_OPTIONS.map((s) => (
                              <SelectItem key={s} value={s}>
                                {STATUS_LABELS[s] ?? s}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-3 align-top whitespace-nowrap text-xs text-muted-foreground">
                        {row.bugType ? BUG_TYPE_LABELS[row.bugType] : '—'}
                      </td>
                      <td className="p-3 align-top max-w-[280px]">
                        <button
                          type="button"
                          className="line-clamp-3 text-left w-full hover:text-primary"
                          title={row.description}
                          onClick={() =>
                            setDetail({
                              open: true,
                              title: 'Description',
                              content: row.description,
                              type: 'plain'
                            })
                          }
                        >
                          {row.description}
                        </button>
                      </td>
                      <td className="p-3 align-top whitespace-nowrap">
                        {row.isAnonymous ? (
                          <span className="text-muted-foreground italic">Anonymous</span>
                        ) : (
                          row.user?.email
                        )}
                      </td>
                      <td className="p-3 align-top whitespace-nowrap text-muted-foreground">
                        {new Date(row.createdAt).toLocaleString()}
                      </td>
                      <td className="p-3 align-top max-w-[140px] truncate text-xs text-muted-foreground" title={row.pageUrl || ''}>
                        {getPagePath(row.pageUrl) || '—'}
                      </td>
                      <td className="p-3 align-top">
                        <div className="flex flex-wrap gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            disabled={!row.consoleLogs}
                            onClick={() =>
                              setDetail({
                                open: true,
                                title: 'Console logs',
                                content: row.consoleLogs || '',
                                type: 'logs'
                              })
                            }
                          >
                            Console
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            disabled={!row.networkLogs}
                            onClick={() =>
                              setDetail({
                                open: true,
                                title: 'Network logs',
                                content: row.networkLogs || '',
                                type: 'logs'
                              })
                            }
                          >
                            Network
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            disabled={!row.screenshot}
                            onClick={() =>
                              setDetail({
                                open: true,
                                title: 'Screenshot',
                                content: row.screenshot || '',
                                type: 'screenshot'
                              })
                            }
                          >
                            Screenshot
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
        </CardContent>
      </Card>

      <DetailDialog
        open={detail.open}
        onClose={() => setDetail({ open: false, title: '', content: '', type: 'logs' })}
        title={detail.title}
        content={detail.content}
        type={detail.type}
      />
    </div>
  );
}
