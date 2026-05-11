import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import api from '~/lib/api';
import { useBugReport } from './useBugReport';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Textarea } from '~/components/ui/textarea';
import { Switch } from '~/components/ui/switch';
import { Button } from '~/components/ui/button';

const bugReportSchema = z.object({
  description: z
    .string()
    .min(10, 'Please provide at least 10 characters')
    .max(2000, 'Description must be 2000 characters or fewer'),
  isAnonymous: z.boolean(),
});

type BugReportFormValues = z.infer<typeof bugReportSchema>;

type BugReportDialogProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

export function BugReportDialog({ open, setOpen }: BugReportDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { context, captureScreenshot, getCapturedData } = useBugReport();

  const form = useForm<BugReportFormValues>({
    resolver: zodResolver(bugReportSchema),
    defaultValues: {
      description: '',
      isAnonymous: false,
    },
  });

  const description = form.watch('description');

  useEffect(() => {
    if (!open) return;
    setSubmitError(null);
    void captureScreenshot();
  }, [captureScreenshot, open]);

  const handleSubmit = form.handleSubmit(async (values) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const capturedData = getCapturedData();
      await api.submitBugReport({
        description: values.description,
        isAnonymous: values.isAnonymous,
        consoleLogs: capturedData.consoleLogs,
        networkLogs: capturedData.networkLogs,
        screenshot: capturedData.screenshot,
        pageUrl: window.location.href,
        userAgent: navigator.userAgent,
        context,
      });
      form.reset({
        description: '',
        isAnonymous: false,
      });
      setOpen(false);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Could not submit bug report.');
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          form.reset({
            description: '',
            isAnonymous: false,
          });
          setSubmitError(null);
        }
        setOpen(nextOpen);
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Report a bug</DialogTitle>
          <DialogDescription>
            We will include console logs, network logs, page details, and a screenshot from this
            page.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="bug-description" className="text-sm font-medium text-foreground">
              Description
            </label>
            <Textarea
              id="bug-description"
              data-testid="bug-description"
              placeholder="What happened and what did you expect?"
              className="min-h-[140px] resize-y"
              {...form.register('description')}
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-destructive">
                {form.formState.errors.description?.message ?? '\u00A0'}
              </p>
              <p
                className={`text-xs ${
                  description.length > 1900
                    ? 'text-destructive'
                    : description.length > 1500
                      ? 'text-amber-500'
                      : 'text-muted-foreground'
                }`}
              >
                {description.length}/2000
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-border px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <label htmlFor="is-anonymous" className="text-sm font-medium text-foreground">
                  Submit anonymously
                </label>
                <p className="text-xs text-muted-foreground">
                  Admins can still triage this report without showing your identity.
                </p>
              </div>
              <Switch
                id="is-anonymous"
                checked={form.watch('isAnonymous')}
                onCheckedChange={(checked) => form.setValue('isAnonymous', Boolean(checked))}
              />
            </div>
          </div>

          {submitError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {submitError}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Submitting...' : 'Submit report'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
