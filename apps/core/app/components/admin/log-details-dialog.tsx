import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@eduai/ui";

type LogDetailsDialogProps = {
  title: string;
  row: Record<string, unknown> | null;
  onClose: () => void;
};

/**
 * Safely serializes structured log data so details are rendered as inert text.
 */
function toSafeJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return JSON.stringify({ error: "Unable to serialize log details." }, null, 2);
  }
}

/**
 * Shared details dialog for log rows.
 *
 * Keeping this in a dedicated component ensures every tab uses the same
 * safe, text-only rendering behavior for potentially untrusted payload fields:
 * the full row is stringified and dropped into a <pre> — never interpreted as
 * HTML — which is the XSS guard for admin log tooling.
 */
export function LogDetailsDialog({ title, row, onClose }: LogDetailsDialogProps) {
  return (
    <Dialog open={row !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-auto">
          {/* Details remain plain text to prevent accidental HTML execution in admin tooling. */}
          <pre className="bg-muted text-muted-foreground whitespace-pre-wrap break-words rounded-lg border p-4 text-xs">
            {row ? toSafeJson(row) : ""}
          </pre>
        </div>
      </DialogContent>
    </Dialog>
  );
}
