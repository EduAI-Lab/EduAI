import {
  Message as BasicMessage,
  MessageAvatar
} from "~/components/ui/message";
import { Loader } from "~/components/ui/loader";

export type ChatTypingIndicatorProps = Record<string, never>;

export function ChatTypingIndicator() {
  return (
    <BasicMessage>
      <MessageAvatar
        src=""
        alt="EduAI"
        fallback="AI"
        className="h-8 w-8"
      />

      <div className="flex flex-col gap-2 flex-1">
        <div className="bg-muted/50 text-foreground max-w-none rounded-lg px-4 py-3">
          <Loader
            variant="text-shimmer"
            text="EduAI is thinking"
            size="sm"
            className="text-muted-foreground"
          />
        </div>
      </div>
    </BasicMessage>
  );
}
