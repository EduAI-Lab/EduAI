/**
 * Admin-only list of bug reports with status updates and attachment viewers.
 */
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '../components/ui/dialog';
import { useToast } from '../components/ui/use-toast';
import { bugReportApi, BugReportRow } from '../services/bugReportApi';
import { useAuth } from '../contexts/AuthContext';

const STATUS_OPTIONS = ['unhandled', 'in progress', 'resolved'] as const;

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
  const { toast } = useToast();
  const [rows, setRows] = useState<BugReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<{
    open: boolean;
    title: string;
    content: string;
    type: 'logs' | 'screenshot' | 'plain';
  }>({ open: false, title: '', content: '', type: 'logs' });

  const load = useCallback(async () => {
    try {
      const data = await bugReportApi.list();
      setRows(data);
    } catch {
      toast({
        title: 'Could not load bug reports',
        description: 'You may not have admin access.',
        variant: 'destructive'
      });
      navigate('/home');
    } finally {
      setLoading(false);
    }
  }, [navigate, toast]);

  useEffect(() => {
    if (isLoading) return;
    if (!user?.isBugReportAdmin) {
      navigate('/home', { replace: true });
      return;
    }
    void load();
  }, [isLoading, user, navigate, load]);

  async function handleStatusChange(bugId: number, newStatus: string) {
    try {
      await bugReportApi.updateStatus(bugId, newStatus);
      setRows((prev) => prev.map((b) => (b.id === bugId ? { ...b, status: newStatus } : b)));
    } catch {
      toast({
        title: 'Failed to update status',
        description: 'Please try again.',
        variant: 'destructive'
      });
    }
  }

  if (!user?.isBugReportAdmin) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="border-b bg-white px-6 py-4 flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/home')} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <h1 className="text-lg font-semibold">Bug reports</h1>
      </div>

      <div className="p-6 overflow-x-auto">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <table className="w-full text-sm border rounded-md">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-left p-3 font-medium">Description</th>
                <th className="text-left p-3 font-medium">User</th>
                <th className="text-left p-3 font-medium">Date</th>
                <th className="text-left p-3 font-medium">Page</th>
                <th className="text-left p-3 font-medium">Attachments</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">
                    No bug reports yet.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-t hover:bg-muted/20">
                    <td className="p-3 align-top">
                      <select
                        value={row.status}
                        onChange={(e) => handleStatusChange(row.id, e.target.value)}
                        className="text-xs border rounded-md px-2 py-1 bg-background"
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-3 align-top max-w-[280px]">
                      <button
                        type="button"
                        className="truncate text-left w-full hover:text-blue-700"
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
                      {row.pageUrl
                        ? (() => {
                            try {
                              return new URL(row.pageUrl).pathname;
                            } catch {
                              return row.pageUrl;
                            }
                          })()
                        : '—'}
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
        )}
      </div>

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
