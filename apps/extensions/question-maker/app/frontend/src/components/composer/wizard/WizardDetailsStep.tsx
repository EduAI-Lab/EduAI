/**
 * Step 2 of the composer wizard: format, topic, difficulty + thinking skill, and a collapsed
 * "More options" disclosure for secondary topics and the description/label. In variant mode
 * the format and topic are inherited from the original and shown read-only.
 */
import type { ReactNode } from "react";
import { Card, CardContent, Label, cn } from "@eduai/ui";
import { IconLock } from "@tabler/icons-react";

import { QuestionTypeSelector } from "../QuestionTypeSelector";
import {
  DescriptionField,
  PrimaryTopicField,
  SecondaryTopicsField,
} from "../ComposerMetadataFields";
import { selectableCardClass } from "@/lib/selectableCard";
import {
  DIFFICULTY_OPTIONS,
  FORMAT_LABELS,
  THINKING_SKILL_OPTIONS,
  type DetailOption,
} from "@/lib/questionDetailsMeta";
import type { QuestionDifficulty, QuestionType, ReasoningLevel } from "@/types/question";
import type { Topic } from "@/types/topic";

const FIELD_LABEL_CLASS = "text-xs font-medium uppercase tracking-wider text-muted-foreground";

export interface WizardDetailsValue {
  questionType: QuestionType;
  primaryTopicId: string;
  secondaryTopicIds: string[];
  description: string;
  difficulty: QuestionDifficulty;
  reasoningLevel: ReasoningLevel;
}

interface WizardDetailsStepProps {
  mode: "question" | "variant";
  value: WizardDetailsValue;
  onChange: (patch: Partial<WizardDetailsValue>) => void;
  topics: Topic[];
  topicsLoading?: boolean;
  disabled?: boolean;
  topicError?: string;
  onCreateTopic?: (name: string) => Promise<Topic>;
  /** Variant mode: the original question's values, marked "(original)" in the lists. */
  original?: {
    topicName?: string;
    difficulty?: QuestionDifficulty;
    reasoningLevel?: ReasoningLevel;
  };
}

export function WizardDetailsStep({
  mode,
  value,
  onChange,
  topics,
  topicsLoading = false,
  disabled = false,
  topicError,
  onCreateTopic,
  original,
}: WizardDetailsStepProps) {
  const isVariant = mode === "variant";
  const lock = <IconLock className="size-4 shrink-0" aria-label="Locked" />;

  return (
    <Card>
      <CardContent className="flex flex-col gap-6 py-6">
        <Section label="Format">
          {isVariant ? (
            <p className="flex items-center gap-1.5 py-2.5 text-sm text-muted-foreground">
              {lock}
              {FORMAT_LABELS[value.questionType]}{" "}
              <span className="text-xs">(same as the original)</span>
            </p>
          ) : (
            <QuestionTypeSelector
              value={value.questionType}
              onChange={(t) => onChange({ questionType: t })}
              disabled={disabled}
            />
          )}
        </Section>

        <PrimaryTopicField
          primaryTopicId={value.primaryTopicId}
          topics={topics}
          topicsLoading={topicsLoading}
          disabled={disabled}
          readOnly={isVariant}
          readOnlyName={original?.topicName}
          readOnlyAdornment={lock}
          error={topicError}
          onChange={(v) => onChange({ primaryTopicId: v })}
          onCreateTopic={isVariant ? undefined : onCreateTopic}
        />

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <OptionList
            id="composer-difficulty"
            label="Difficulty"
            options={DIFFICULTY_OPTIONS}
            value={value.difficulty}
            originalValue={isVariant ? original?.difficulty : undefined}
            onChange={(v) => onChange({ difficulty: v })}
            disabled={disabled}
          />
          <OptionList
            id="composer-thinking-skill"
            label="Thinking skill"
            helper="what students have to do"
            options={THINKING_SKILL_OPTIONS}
            value={value.reasoningLevel}
            originalValue={isVariant ? original?.reasoningLevel : undefined}
            onChange={(v) => onChange({ reasoningLevel: v })}
            disabled={disabled}
          />
        </div>

        <details>
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            More options
          </summary>
          <div className="mt-4 flex flex-col gap-4">
            <SecondaryTopicsField
              primaryTopicId={value.primaryTopicId}
              secondaryTopicIds={value.secondaryTopicIds}
              topics={topics}
              disabled={disabled}
              onChange={(v) => onChange({ secondaryTopicIds: v })}
            />
            <DescriptionField
              value={value.description}
              disabled={disabled}
              placeholder="Leave blank to use the question's first line"
              onChange={(v) => onChange({ description: v })}
            />
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className={FIELD_LABEL_CLASS}>{label}</Label>
      {children}
    </div>
  );
}

interface OptionListProps<T extends string> {
  id: string;
  label: string;
  helper?: string;
  options: DetailOption<T>[];
  value: T;
  originalValue?: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}

/** Vertical list of selectable options, each with a one-line hint. */
function OptionList<T extends string>({
  id,
  label,
  helper,
  options,
  value,
  originalValue,
  onChange,
  disabled = false,
}: OptionListProps<T>) {
  const labelId = `${id}-label`;
  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className={FIELD_LABEL_CLASS}>
        {label}
        {helper && (
          <span className="ml-1 font-normal normal-case text-muted-foreground">({helper})</span>
        )}
      </span>
      <div id={id} role="radiogroup" aria-labelledby={labelId} className="flex flex-col gap-2">
        {options.map((opt) => {
          const selected = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(opt.value)}
              className={cn(
                "flex-col items-start gap-0.5 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selectableCardClass(selected, disabled),
              )}
            >
              <span className="text-sm font-semibold text-foreground">
                {opt.label}
                {opt.value === originalValue && (
                  <span className="ml-1 font-normal text-muted-foreground">(original)</span>
                )}
              </span>
              <span className="text-xs leading-snug text-muted-foreground">{opt.hint}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
