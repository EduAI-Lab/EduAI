/**
 * Target-bank picker for one question (#1762). "move" takes it out of the bank in
 * view; "add" puts it in another bank alongside its current ones. Bank membership is
 * per question, so every variant goes with it.
 */
import { useEffect, useState } from "react";
import { isAxiosError } from "axios";
import {
  Alert,
  AlertDescription,
  Button,
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
} from "@eduai/ui";
import { questionBankService, type QuestionBank } from "../../services/questionBankService";

export type BankMembershipAction = "move" | "add";

interface MoveQuestionToBankDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: BankMembershipAction;
  courseId: number;
  questionId: number;
  banks: QuestionBank[];
  /** The bank in view — required to move, and never offered as a target. */
  currentBankId?: string | null;
  onSuccess: (targetBank: QuestionBank) => void;
}

export function MoveQuestionToBankDialog({
  open,
  onOpenChange,
  mode,
  courseId,
  questionId,
  banks,
  currentBankId,
  onSuccess,
}: MoveQuestionToBankDialogProps) {
  const [targetBankId, setTargetBankId] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memberBankIds, setMemberBankIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setTargetBankId("");
    setError(null);
    setMemberBankIds([]);

    let cancelled = false;
    questionBankService
      .listBankIdsForQuestion(courseId, questionId)
      // A failed lookup only costs the pre-filter: the server rejects a duplicate anyway.
      .catch(() => [] as string[])
      .then((bankIds) => {
        if (!cancelled) setMemberBankIds(bankIds);
      });
    return () => {
      cancelled = true;
    };
  }, [open, questionId, mode, courseId]);

  const isMove = mode === "move";
  const targets = isMove ? banks.filter((bank) => bank.id !== currentBankId) : banks;
  const holdsQuestion = (bankId: string) => memberBankIds.includes(bankId);
  const selectable = targets.filter((bank) => !holdsQuestion(bank.id));
  const target = selectable.find((bank) => bank.id === targetBankId) ?? null;

  const handleConfirm = async () => {
    if (!target || isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      if (isMove) {
        if (!currentBankId) throw new Error("There is no bank to move this question out of.");
        await questionBankService.moveQuestionToBank(
          courseId,
          currentBankId,
          questionId,
          target.id,
        );
      } else {
        await questionBankService.addQuestionToBank(courseId, target.id, questionId);
      }
      onSuccess(target);
      onOpenChange(false);
    } catch (err) {
      if (isAxiosError<{ error?: string }>(err)) {
        setError(err.response?.data?.error || err.message);
      } else {
        setError(err instanceof Error ? err.message : "Please try again.");
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !isSaving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isMove ? "Move to bank" : "Add to bank"}</DialogTitle>
          <DialogDescription>
            {isMove
              ? `Moves question #${questionId} and all its variants.`
              : `Adds question #${questionId} and all its variants. It stays in its current banks.`}
          </DialogDescription>
        </DialogHeader>

        {targets.length === 0 ? (
          <p className="text-sm text-muted-foreground">Create a bank on the Banks tab first.</p>
        ) : (
          <>
            <Select value={targetBankId} onValueChange={setTargetBankId} disabled={isSaving}>
              <SelectTrigger aria-label="Target bank">
                <SelectValue placeholder="Choose a bank" />
              </SelectTrigger>
              <SelectContent>
                {targets.map((bank) => {
                  const label = bank.isDefault ? `${bank.name} (default)` : bank.name;
                  const taken = holdsQuestion(bank.id);
                  return (
                    <SelectItem key={bank.id} value={bank.id} disabled={taken}>
                      {taken ? `${label} — already in this bank` : label}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {selectable.length === 0 && (
              <p className="text-sm text-muted-foreground">
                This question is already in every other bank.
              </p>
            )}
          </>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={() => void handleConfirm()} disabled={!target || isSaving}>
            {isSaving ? "Saving…" : isMove ? "Move" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
