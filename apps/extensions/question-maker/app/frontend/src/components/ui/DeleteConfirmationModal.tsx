/**
 * Reusable confirmation dialog for delete flows with optional destructive styling.
 */
import * as React from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@eduai/ui';
import { AlertTriangle } from 'lucide-react';

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
    await onConfirm();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-full ${
              variant === 'destructive' ? 'bg-red-100 dark:bg-red-900/20' : 'bg-muted dark:bg-muted'
            }`}>
              <AlertTriangle className={`h-5 w-5 ${
                variant === 'destructive' ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground dark:text-muted-foreground'
              }`} />
            </div>
            <DialogTitle className="text-left">{title}</DialogTitle>
          </div>
          {message && (
            <DialogDescription className="pt-2 text-left">
              {message}
            </DialogDescription>
          )}
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={variant}
            onClick={handleConfirm}
            disabled={isLoading}
          >
            {isLoading ? 'Deleting...' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
