/**
 * @file The publish/unpublish confirm shared by module and lesson controls.
 */
import type { ReactNode } from "react";
import { ConfirmDialog } from "@eduai/ui";

export type PublishTarget = { title: string; isPublished: boolean };

export function PublishConfirmDialog({
  target,
  onCancel,
  onConfirm,
  children,
}: {
  target: PublishTarget | null;
  onCancel: () => void;
  onConfirm: () => void;
  /** Extra options shown only when publishing. */
  children?: ReactNode;
}) {
  const unpublishing = target?.isPublished ?? false;
  return (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={target ? `${unpublishing ? "Unpublish" : "Publish"} "${target.title}"?` : ""}
      description={
        target
          ? unpublishing
            ? "Students will lose access to this content."
            : "Students will be able to see this content."
          : ""
      }
      confirmLabel={unpublishing ? "Unpublish" : "Publish"}
      variant={unpublishing ? "destructive" : "default"}
      onConfirm={onConfirm}
    >
      {target && !unpublishing ? children : null}
    </ConfirmDialog>
  );
}
