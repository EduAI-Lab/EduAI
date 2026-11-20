/** Step 3 header: the chosen details as chips plus an "Edit details" link back to step 2. */
import { Badge, Button } from "@eduai/ui";

interface WizardDetailsSummaryProps {
  format: string;
  topic?: string;
  difficulty: string;
  thinkingSkill: string;
  onEdit: () => void;
  disabled?: boolean;
}

export function WizardDetailsSummary({
  format,
  topic,
  difficulty,
  thinkingSkill,
  onEdit,
  disabled = false,
}: WizardDetailsSummaryProps) {
  const chips = [format, topic, difficulty, thinkingSkill].filter((c): c is string => Boolean(c));
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="details-summary">
      {chips.map((chip) => (
        <Badge key={chip} variant="muted">
          {chip}
        </Badge>
      ))}
      <Button
        type="button"
        variant="link"
        size="sm"
        onClick={onEdit}
        disabled={disabled}
        className="h-auto px-1"
      >
        Edit details
      </Button>
    </div>
  );
}
