/**
 * Composer wizard footer: Back (hidden on step 1) and Cancel on the left; on step 3 the
 * "Save as Draft / Reviewed" choice and the "Share with other EduAI tools" checkbox, then the
 * primary button (Continue on steps 1–2, the save action on step 3) on the right.
 */
import { Link } from "react-router";
import { Button, HelpHint, Label } from "@eduai/ui";
import { IconCornerDownLeft, IconDeviceFloppy } from "@tabler/icons-react";
import { QUESTION_MAKER_HELP } from "@/lib/helpHints";

const CONTROL_CLASS = "size-4 cursor-pointer rounded border-border [accent-color:var(--secondary)]";

export interface WizardSaveOptions {
  reviewed: boolean;
  share: boolean;
  /** False when the user may only save drafts (e.g. a TA). */
  canReview: boolean;
  onReviewedChange: (reviewed: boolean) => void;
  onShareChange: (share: boolean) => void;
}

interface WizardFooterProps {
  showBack: boolean;
  onBack: () => void;
  onCancel: () => void;
  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  /** Present on step 3 only: renders the save choices and the save icon/shortcut hint. */
  saveOptions?: WizardSaveOptions;
  busy?: boolean;
}

export function WizardFooter({
  showBack,
  onBack,
  onCancel,
  primaryLabel,
  onPrimary,
  primaryDisabled = false,
  saveOptions,
  busy = false,
}: WizardFooterProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        {showBack && (
          <Button variant="outline" onClick={onBack} disabled={busy}>
            Back
          </Button>
        )}
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
        {saveOptions && <SaveOptions {...saveOptions} disabled={busy} />}
        <Button onClick={onPrimary} disabled={busy || primaryDisabled} className="gap-1.5">
          {saveOptions && <IconDeviceFloppy className="size-4" />}
          {busy && saveOptions ? "Saving…" : primaryLabel}
          {saveOptions && (
            <kbd className="ml-1 hidden items-center gap-0.5 rounded border border-primary-foreground/30 px-1 text-[10px] sm:inline-flex">
              <IconCornerDownLeft className="size-3" />
            </kbd>
          )}
        </Button>
      </div>
    </div>
  );
}

function SaveOptions({
  reviewed,
  share,
  canReview,
  onReviewedChange,
  onShareChange,
  disabled,
}: WizardSaveOptions & { disabled: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <div role="radiogroup" aria-label="Save as" className="flex items-center gap-3">
        <span className="text-muted-foreground">Save as:</span>
        <label className="flex cursor-pointer items-center gap-1.5 text-foreground">
          <input
            type="radio"
            name="composer-save-as"
            checked={!reviewed}
            onChange={() => onReviewedChange(false)}
            disabled={disabled}
            className={CONTROL_CLASS}
          />
          Draft
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-foreground">
          <input
            type="radio"
            name="composer-save-as"
            checked={reviewed}
            onChange={() => onReviewedChange(true)}
            disabled={disabled || !canReview}
            className={CONTROL_CLASS}
          />
          Reviewed
        </label>
        <HelpHint {...QUESTION_MAKER_HELP.draftVsReviewed} LinkComponent={Link} />
      </div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="composer-share-with-extensions"
          data-testid="share-with-extensions"
          checked={share}
          onChange={(e) => onShareChange(e.target.checked)}
          disabled={disabled || !canReview || !reviewed}
          className={CONTROL_CLASS}
        />
        <Label
          htmlFor="composer-share-with-extensions"
          className={`cursor-pointer text-sm ${reviewed ? "text-foreground" : "text-muted-foreground"}`}
        >
          Share with other EduAI tools
        </Label>
      </div>
    </div>
  );
}
