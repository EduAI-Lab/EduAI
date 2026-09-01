/**
 * Dialog to sync a Classic Canvas Assessment Question Bank into a local course bank.
 * One-way Canvas → EduAI; re-sync upserts by Canvas question id.
 */
import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Button,
  Label,
} from "@eduai/ui";
import { toast } from "sonner";
import { useQmPermissionsForCourse } from "@/hooks/useQmPermissions";
import canvasService, { CanvasIntegration, CanvasQuestionBank } from "../../services/canvasService";
import { courseService } from "../../services/courseService";
import { questionBankService, QuestionBank } from "../../services/questionBankService";
import { Topic } from "../../types/topic";

interface CanvasCourseLink {
  canvasCourseId: number;
  canvasCourseName: string;
}

interface CanvasBankSyncDialogProps {
  open: boolean;
  onClose: () => void;
  localCourseId: number | null;
  selectedLocalBankId?: string | null;
  onSyncSuccess?: (result: {
    bankId: string;
    created: number;
    updated: number;
    skipped: number;
  }) => void;
}

export const CanvasBankSyncDialog = ({
  open,
  onClose,
  localCourseId,
  selectedLocalBankId = null,
  onSyncSuccess,
}: CanvasBankSyncDialogProps) => {
  const { canManageCanvas } = useQmPermissionsForCourse(localCourseId);
  const [integration, setIntegration] = useState<CanvasIntegration | null>(null);
  // The Canvas course is never picked: banks sync from the Canvas course this
  // local course was linked to, into this local course.
  const [linkedCanvasCourse, setLinkedCanvasCourse] = useState<CanvasCourseLink | null>(null);
  const [isLoadingMapping, setIsLoadingMapping] = useState(false);
  const [banks, setBanks] = useState<CanvasQuestionBank[]>([]);
  const [localBanks, setLocalBanks] = useState<QuestionBank[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);

  const [selectedCanvasBankId, setSelectedCanvasBankId] = useState("");
  const [selectedTopicId, setSelectedTopicId] = useState("");
  const [targetBankId, setTargetBankId] = useState<string>("__new__");

  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingBanks, setIsLoadingBanks] = useState(false);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      setIntegration(await canvasService.getIntegration());
    })();
  }, [open]);

  useEffect(() => {
    if (!open || !localCourseId) return;
    void (async () => {
      const [topicList, bankList] = await Promise.all([
        courseService.getCourseTopics(localCourseId),
        questionBankService.listBanks(localCourseId),
      ]);
      setTopics(topicList);
      setLocalBanks(bankList);
      if (selectedLocalBankId) {
        setTargetBankId(String(selectedLocalBankId));
      }
      if (topicList[0]) {
        setSelectedTopicId(String(topicList[0].id));
      }
    })();
  }, [open, localCourseId, selectedLocalBankId]);

  useEffect(() => {
    if (!open || !localCourseId || !integration?.isConnected) {
      setLinkedCanvasCourse(null);
      setBanks([]);
      setSelectedCanvasBankId("");
      return;
    }
    void loadLinkedCanvasCourse(localCourseId);
  }, [open, localCourseId, integration]);

  /** Resolves the Canvas course this local course was synced from; null when unlinked. */
  const loadLinkedCanvasCourse = async (courseId: number) => {
    setIsLoadingMapping(true);
    try {
      const mapping = await canvasService.getCourseMapping(courseId);
      const canvasCourseId = mapping?.canvasCourseId ? Number(mapping.canvasCourseId) : null;
      if (!canvasCourseId) {
        setLinkedCanvasCourse(null);
        setBanks([]);
        setSelectedCanvasBankId("");
        return;
      }
      setLinkedCanvasCourse({
        canvasCourseId,
        canvasCourseName: mapping.canvasCourseName || `Canvas course ${canvasCourseId}`,
      });
      await loadCanvasBanks(canvasCourseId);
    } finally {
      setIsLoadingMapping(false);
    }
  };

  const loadCanvasBanks = async (canvasCourseId: number) => {
    setIsLoadingBanks(true);
    try {
      const list = await canvasService.getQuestionBanks(canvasCourseId);
      setBanks(list);
    } catch (error: any) {
      toast.error("Failed to load Canvas banks", {
        description: error?.response?.data?.error || error.message,
      });
      setBanks([]);
    } finally {
      setIsLoadingBanks(false);
    }
  };

  const handleSync = async () => {
    if (!localCourseId || !linkedCanvasCourse || !selectedCanvasBankId || !selectedTopicId) {
      toast.error("Missing fields", {
        description: "Select a Canvas bank and a local topic.",
      });
      return;
    }
    setIsLoading(true);
    try {
      const result = await canvasService.importQuestionBank(
        linkedCanvasCourse.canvasCourseId,
        Number(selectedCanvasBankId),
        localCourseId,
        {
          primaryTopicId: selectedTopicId,
          targetBankId: targetBankId === "__new__" ? undefined : targetBankId,
        },
      );
      toast("Bank synced", {
        description: `Created ${result.created}, updated ${result.updated}, skipped ${result.skipped}`,
      });
      onSyncSuccess?.(result);
      onClose();
    } catch (error: any) {
      toast.error("Sync failed", {
        description: error?.response?.data?.error || error.message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const canSync =
    integration?.isConnected &&
    linkedCanvasCourse &&
    selectedCanvasBankId &&
    selectedTopicId &&
    !isLoading;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="sm:max-w-[600px] max-h-[90vh] flex flex-col overflow-hidden p-0 gap-0"
        data-testid="canvas-bank-sync-dialog"
      >
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4 border-b border-border">
          <DialogTitle>Sync question bank from Canvas</DialogTitle>
          <DialogDescription>
            One-way import from Classic Canvas Assessment Question Banks into EduAI. Re-sync updates
            existing questions without duplicates.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {!canManageCanvas ? (
            <p className="text-sm text-muted-foreground">
              Canvas bank sync is available to instructors and administrators only.
            </p>
          ) : !integration?.isConnected ? (
            <p className="text-sm text-muted-foreground">
              Canvas is not connected. Connect Canvas in your EduAI settings, then reopen this
              dialog.
            </p>
          ) : isLoadingMapping ? (
            <div className="text-sm text-muted-foreground">Loading Canvas course...</div>
          ) : !linkedCanvasCourse ? (
            <p className="text-sm text-muted-foreground">
              This course is not linked to a Canvas course. Sync the course from Canvas before
              importing question banks.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Canvas course</Label>
                <p className="text-sm" data-testid="linked-canvas-course">
                  {linkedCanvasCourse.canvasCourseName}
                </p>
                <p className="text-xs text-muted-foreground">
                  Banks sync from the Canvas course this course is linked to, into this course.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Canvas question bank</Label>
                {isLoadingBanks ? (
                  <div className="text-sm text-muted-foreground">Loading banks...</div>
                ) : (
                  <Select value={selectedCanvasBankId} onValueChange={setSelectedCanvasBankId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select bank" />
                    </SelectTrigger>
                    <SelectContent>
                      {banks.map((b) => (
                        <SelectItem key={b.id} value={String(b.id)}>
                          {b.title || b.name || `Bank ${b.id}`}
                          {b.question_count != null ? ` (${b.question_count})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="space-y-2">
                <Label>Local topic</Label>
                <Select value={selectedTopicId} onValueChange={setSelectedTopicId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select topic" />
                  </SelectTrigger>
                  <SelectContent>
                    {topics.map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Destination local bank</Label>
                <Select value={targetBankId} onValueChange={setTargetBankId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__new__">Create bank from Canvas name</SelectItem>
                    {localBanks.map((b) => (
                      <SelectItem key={b.id} value={String(b.id)}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t border-border px-6 py-4 flex-row gap-2 sm:justify-between">
          <Button variant="outline" onClick={onClose}>
            {canManageCanvas ? "Cancel" : "Close"}
          </Button>
          {canManageCanvas && (
            <Button onClick={handleSync} disabled={!canSync} data-testid="sync-bank-submit">
              {isLoading ? "Syncing..." : "Sync bank"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
