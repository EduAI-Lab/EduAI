import { useEffect, useState } from 'react';

import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Label } from './ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Switch } from './ui/switch';
import { Textarea } from './ui/textarea';

export type BugReportType =
  | 'UI_DISPLAY'
  | 'FEATURE_NOT_WORKING'
  | 'PERFORMANCE'
  | 'CONTENT_ERROR'
  | 'ACCESS_PERMISSION'
  | 'OTHER';

export type BugReportSubmitData = {
  description: string;
  bugType: BugReportType | null;
  isAnonymous: boolean;
  consoleLogs?: string | null;
  networkLogs?: string | null;
  screenshot?: string | null;
  pageUrl?: string;
  userAgent?: string;
};

const BUG_TYPE_OPTIONS: { value: BugReportType; label: string }[] = [
  { value: 'UI_DISPLAY', label: 'UI / display issue' },
  { value: 'FEATURE_NOT_WORKING', label: 'Feature not working' },
  { value: 'PERFORMANCE', label: 'Performance issue' },
  { value: 'CONTENT_ERROR', label: 'Content error' },
  { value: 'ACCESS_PERMISSION', label: 'Access / permission issue' },
  { value: 'OTHER', label: 'Other' },
];

const MIN_DESC = 10;
const MAX_DESC = 2000;

type BugReportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called on submit. Throw to surface an inline error; resolve to close the dialog. */
  onSubmit: (data: BugReportSubmitData) => Promise<void>;
  /** If provided, called when the dialog opens to refresh the screenshot cache. */
  captureScreenshot?: () => Promise<string | null>;
  /** If provided, diagnostic data is attached to the submission automatically. */
  getCapturedData?: () => { consoleLogs: string; networkLogs: string; screenshot: string | null };
};

export function BugReportDialog({
  open,
  onOpenChange,
  onSubmit,
  captureScreenshot,
  getCapturedData,
}: BugReportDialogProps) {
  const [description, setDescription] = useState('');
  const [bugType, setBugType] = useState<BugReportType | null>(null);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [descError, setDescError] = useState<string | null>(null);
  const [typeError, setTypeError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSubmitError(null);
    if (captureScreenshot) {
      void captureScreenshot();
    }
  }, [captureScreenshot, open]);

  const reset = () => {
    setDescription('');
    setBugType(null);
    setIsAnonymous(false);
    setDescError(null);
    setTypeError(null);
    setSubmitError(null);
  };

  const handleClose = () => {
    reset();
    onOpenChange(false);
  };

  const validate = (): boolean => {
    let valid = true;
    const trimmed = description.trim();
    if (trimmed.length < MIN_DESC) {
      setDescError(`Please provide at least ${MIN_DESC} characters`);
      valid = false;
    } else if (trimmed.length > MAX_DESC) {
      setDescError(`Description must be ${MAX_DESC} characters or fewer`);
      valid = false;
    } else {
      setDescError(null);
    }
    if (!bugType) {
      setTypeError('Please select a bug type');
      valid = false;
    } else {
      setTypeError(null);
    }
    return valid;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const data: BugReportSubmitData = {
        description: description.trim(),
        bugType,
        isAnonymous,
      };
      if (getCapturedData) {
        const captured = getCapturedData();
        data.consoleLogs = captured.consoleLogs;
        data.networkLogs = captured.networkLogs;
        data.screenshot = captured.screenshot;
        data.pageUrl = window.location.href;
        data.userAgent = navigator.userAgent;
      }
      await onSubmit(data);
      handleClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not submit bug report.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) handleClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Report a bug</DialogTitle>
          <DialogDescription>Describe the issue you encountered.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="bug-report-type">Bug type</Label>
            <Select
              value={bugType ?? ''}
              onValueChange={(value) => {
                setBugType(value as BugReportType);
                setTypeError(null);
              }}
            >
              <SelectTrigger id="bug-report-type" data-testid="bug-type">
                <SelectValue placeholder="Select a type" />
              </SelectTrigger>
              <SelectContent>
                {BUG_TYPE_OPTIONS.map(({ value, label }) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-destructive">{typeError ?? ' '}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="bug-report-description">Description</Label>
            <Textarea
              id="bug-report-description"
              data-testid="bug-description"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setDescError(null);
              }}
              placeholder="Steps to reproduce, expected vs actual behavior"
              className="min-h-[140px] resize-y"
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-destructive">{descError ?? ' '}</p>
              <p
                className={`text-xs ${
                  description.length > 1900
                    ? 'text-destructive'
                    : description.length > 1500
                      ? 'text-amber-500'
                      : 'text-muted-foreground'
                }`}
              >
                {description.length}/{MAX_DESC}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label htmlFor="bug-report-anonymous">Submit anonymously</Label>
              <p className="text-xs text-muted-foreground">Your name is hidden in admin triage views.</p>
            </div>
            <Switch
              id="bug-report-anonymous"
              checked={isAnonymous}
              onCheckedChange={setIsAnonymous}
            />
          </div>

          {submitError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {submitError}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={isSubmitting}>
            {isSubmitting ? 'Submitting…' : 'Submit report'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
