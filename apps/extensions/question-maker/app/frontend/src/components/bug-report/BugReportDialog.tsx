/**
 * Modal form for submitting a bug report with optional anonymous mode.
 */
import { useState, useRef, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog';
import { Textarea } from '../ui/textarea';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { useToast } from '../ui/use-toast';
import { bugReportApi } from '../../services/bugReportApi';

const MAX_DESC = 2000;
const MIN_DESC = 10;

interface BugReportDialogProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  getCapturedData: () => { consoleLogs: string; networkLogs: string; screenshot: string | null };
  userEmail: string;
}

export function BugReportDialog({ open, setOpen, getCapturedData, userEmail }: BugReportDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [description, setDescription] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [descError, setDescError] = useState<string | null>(null);
  const { toast } = useToast();
  const capturedRef = useRef({
    consoleLogs: '[]',
    networkLogs: '[]',
    screenshot: null as string | null
  });

  useEffect(() => {
    if (!open) return;
    const data = getCapturedData();
    capturedRef.current.consoleLogs = data.consoleLogs;
    capturedRef.current.networkLogs = data.networkLogs;
    capturedRef.current.screenshot = data.screenshot;
  }, [open, getCapturedData]);

  function validate(): boolean {
    const t = description.trim();
    if (t.length < MIN_DESC) {
      setDescError(`Please use at least ${MIN_DESC} characters.`);
      return false;
    }
    if (t.length > MAX_DESC) {
      setDescError(`Description must be under ${MAX_DESC} characters.`);
      return false;
    }
    setDescError(null);
    return true;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      await bugReportApi.submit({
        description: description.trim(),
        consoleLogs: capturedRef.current.consoleLogs,
        networkLogs: capturedRef.current.networkLogs,
        screenshot: capturedRef.current.screenshot,
        pageUrl: window.location.href,
        userAgent: navigator.userAgent,
        isAnonymous
      });
      toast({
        title: 'Bug report submitted',
        description: 'Thank you for your feedback.'
      });
      setDescription('');
      setIsAnonymous(false);
      setOpen(false);
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
          : undefined;
      toast({
        title: 'Failed to submit',
        description: message || 'Please try again.',
        variant: 'destructive'
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          setDescription('');
          setDescError(null);
          setIsAnonymous(false);
        }
        setOpen(isOpen);
      }}
    >
      <DialogContent className="w-[90vw] max-w-[560px] p-0 overflow-hidden border-0 shadow-2xl sm:rounded-lg">
        <div className="bg-blue-700 px-6 pt-6 pb-4">
          <DialogHeader>
            <DialogTitle className="text-white text-lg font-semibold tracking-tight">Report a Bug</DialogTitle>
          </DialogHeader>
        </div>

        <form onSubmit={onSubmit} className="px-6 pb-6 pt-4 space-y-4">
          <div className="space-y-2">
            <Textarea
              placeholder="What happened? What did you expect to happen?"
              className="min-h-[120px] resize-none text-sm leading-relaxed"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setDescError(null);
              }}
            />
            <div className="flex items-center justify-between">
              {descError ? <p className="text-xs text-destructive">{descError}</p> : <span />}
              <span
                className={`text-xs tabular-nums ${
                  description.length > 1900
                    ? 'text-red-500'
                    : description.length > 1500
                      ? 'text-amber-600'
                      : 'text-muted-foreground'
                }`}
              >
                {description.length}/{MAX_DESC}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3 gap-3">
            <div className="space-y-0.5 min-w-0">
              <Label htmlFor="anonymous-bug" className="text-sm font-medium cursor-pointer">
                Submit anonymously
              </Label>
              <p className="text-xs text-muted-foreground">
                {isAnonymous ? (
                  'Your identity will be hidden from admins.'
                ) : (
                  <>
                    Submitting as <span className="font-medium text-foreground">{userEmail}</span>
                  </>
                )}
              </p>
            </div>
            <input
              id="anonymous-bug"
              type="checkbox"
              className="h-4 w-4 shrink-0 rounded border-gray-300"
              checked={isAnonymous}
              onChange={(e) => setIsAnonymous(e.target.checked)}
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} className="text-muted-foreground">
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} className="bg-blue-700 hover:bg-blue-800 text-white min-w-[100px]">
              {submitting ? (
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                'Submit Report'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
