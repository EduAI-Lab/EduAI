import { cn } from "@eduai/ui";
import {
  IconAlertCircle,
  IconFileText,
  IconLoader2,
  IconRefresh,
  IconX,
} from "@tabler/icons-react";
import type { ChatAttachmentItem } from "~/components/chat/use-chat-attachments";

type ChipItem = Pick<ChatAttachmentItem, "id" | "name"> & Partial<ChatAttachmentItem>;

/** File chips for the composer (removable) and for sent messages (read-only). */
export function ChatAttachmentChips({
  items,
  onRemove,
  onRetry,
  className,
}: {
  items: ChipItem[];
  onRemove?: (id: string) => void;
  onRetry?: (id: string) => void;
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)} aria-label="Attached files">
      {items.map((item) => (
        <li
          key={item.id}
          className={cn(
            "flex max-w-full items-center gap-1 rounded-lg border px-2 py-1 text-xs",
            item.status === "failed"
              ? "border-destructive/50 bg-destructive/5"
              : "border-border/60 bg-background/80",
          )}
        >
          {item.status === "pending" ? (
            <IconLoader2 size={12} className="shrink-0 animate-spin" aria-label="Reading file" />
          ) : item.status === "failed" ? (
            <IconAlertCircle size={12} className="shrink-0 text-destructive" aria-hidden />
          ) : (
            <IconFileText size={12} className="shrink-0" aria-hidden />
          )}
          <span className="max-w-[160px] truncate">{item.name}</span>
          {item.truncated && (
            <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">
              truncated
            </span>
          )}
          {item.status === "failed" && item.error && (
            <span className="text-destructive">{item.error}</span>
          )}
          {item.status === "failed" && onRetry && (
            <button
              type="button"
              onClick={() => onRetry(item.id)}
              aria-label={`Retry ${item.name}`}
            >
              <IconRefresh size={12} />
            </button>
          )}
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(item.id)}
              aria-label={`Remove ${item.name}`}
            >
              <IconX size={12} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
