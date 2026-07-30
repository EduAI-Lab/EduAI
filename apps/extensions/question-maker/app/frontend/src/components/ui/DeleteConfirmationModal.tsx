/**
 * Reusable confirmation dialog for dangerous actions (delete, publish/unpublish, …).
 * Built on the shared `@eduai/ui` AlertDialog so every confirmation across the
 * suite looks and behaves the same. Keeps a stable prop API for existing call
 * sites; despite the historical name it is not delete-specific.
 */
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from '@eduai/ui';
import { IconAlertTriangle } from '@tabler/icons-react';

interface DeleteConfirmationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isLoading?: boolean;
  variant?: 'default' | 'destructive';
}

export const DeleteConfirmationModal = ({
  open,
  onOpenChange,
  onConfirm,
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  isLoading = false,
  variant = 'destructive',
}: DeleteConfirmationModalProps) => {
  const handleConfirm = async () => {
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // Leave the dialog open so the user can retry after an error toast.
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-[425px]">
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-full ${
                variant === 'destructive' ? 'bg-red-100 dark:bg-red-900/20' : 'bg-muted dark:bg-muted'
              }`}
            >
              <IconAlertTriangle
                className={`h-5 w-5 ${
                  variant === 'destructive'
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-muted-foreground dark:text-muted-foreground'
                }`}
              />
            </div>
            <AlertDialogTitle className="text-left">{title}</AlertDialogTitle>
          </div>
          {message && (
            <AlertDialogDescription className="pt-2 text-left">
              {message}
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            {cancelLabel}
          </Button>
          <Button variant={variant} onClick={handleConfirm} disabled={isLoading}>
            {isLoading ? `${confirmLabel}…` : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
