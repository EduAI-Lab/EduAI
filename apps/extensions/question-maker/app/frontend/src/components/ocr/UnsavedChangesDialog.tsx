import { AlertTriangle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { Button } from '../ui/button';

interface UnsavedChangesDialogProps {
  open: boolean;
  questionsCount: number;
  canSave: boolean;
  isSaving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export function UnsavedChangesDialog({
  open,
  questionsCount,
  canSave,
  isSaving,
  onSave,
  onDiscard,
  onCancel,
}: UnsavedChangesDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-500/10">
              <AlertTriangle className="size-5 text-amber-500" />
            </div>
            <AlertDialogTitle>Unsaved Questions</AlertDialogTitle>
          </div>
          <AlertDialogDescription className="pt-2 space-y-1">
            <p>
              You have{' '}
              <span className="font-medium text-foreground">
                {questionsCount} extracted question{questionsCount !== 1 ? 's' : ''}
              </span>{' '}
              that haven&apos;t been saved yet. What would you like to do?
            </p>
            <p className="text-xs text-muted-foreground/90">
              Discarding keeps them in the History panel so you can restore later.
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter className="sm:flex-row gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={isSaving} title="Return to the dialog and keep editing">
            Keep Editing
          </Button>
          <Button
            variant="outline"
            onClick={onDiscard}
            disabled={isSaving}
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
            title="Close without saving; questions stay in History for later"
          >
            Discard
          </Button>
          <Button onClick={onSave} disabled={!canSave || isSaving} title={canSave ? 'Save now and close' : 'Add at least one question and assessment details to save'}>
            {isSaving ? 'Saving...' : 'Save Questions'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
