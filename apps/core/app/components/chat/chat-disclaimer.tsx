import { useState } from "react";
import { IconInfoCircle } from "@tabler/icons-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@eduai/ui";
import {
  CHAT_DISCLAIMER_CLOSING,
  CHAT_DISCLAIMER_LONG_SECTIONS,
  CHAT_DISCLAIMER_SHORT,
} from "~/lib/chat-disclaimer-content";

export function ChatDisclaimer() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div
        role="note"
        aria-label="Chatbot disclaimer"
        className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-[13px] leading-relaxed text-muted-foreground"
      >
        <div className="flex gap-2.5">
          <IconInfoCircle
            size={16}
            className="mt-0.5 shrink-0 text-muted-foreground"
            stroke={1.75}
            aria-hidden
          />
          <p>
            {CHAT_DISCLAIMER_SHORT}{" "}
            <Button
              type="button"
              variant="link"
              className="h-auto p-0 text-[13px] font-medium text-primary align-baseline"
              onClick={() => setOpen(true)}
            >
              View full terms
            </Button>
          </p>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Chatbot disclaimer and terms</DialogTitle>
            <DialogDescription>
              Please review these terms before relying on chatbot responses.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 text-sm leading-relaxed text-foreground">
            {CHAT_DISCLAIMER_LONG_SECTIONS.map((section) => (
              <section key={section.title} className="space-y-2">
                <h3 className="text-sm font-semibold">{section.title}</h3>
                <p className="text-muted-foreground whitespace-pre-wrap">{section.body}</p>
              </section>
            ))}
            <p className="text-muted-foreground">{CHAT_DISCLAIMER_CLOSING}</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
