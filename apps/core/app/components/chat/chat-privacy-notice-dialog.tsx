import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@eduai/ui";

interface ChatPrivacyNoticeDialogProps {
  open: boolean;
  onAcknowledge: () => void;
}

export function ChatPrivacyNoticeDialog({
  open,
  onAcknowledge,
}: ChatPrivacyNoticeDialogProps) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent
        className="max-w-md"
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Your chat may be reviewed</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
              <p>
                Course chats in EduAI are not private. Your instructor, teaching
                assistants, and platform admins can view your conversation history
                for this course.
              </p>
              <p>
                Do not share passwords, personal health information, or anything you
                would not want your instructor to read.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={onAcknowledge} className="w-full sm:w-auto">
            I understand
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
