/**
 * Metadata fields for the Question Composer: difficulty, reasoning level, primary topic
 * (Combobox), secondary topics (MultiSelect), and an optional description/label.
 * Built for the full-page layout; uses @eduai/ui primitives + CSS vars only.
 */
import { Label, Input, Combobox, MultiSelect } from '@eduai/ui';

import type { QuestionDifficulty, ReasoningLevel } from '../../types/question';
import type { Topic } from '../../types/topic';
import { DifficultySlider } from './DifficultySlider';
import { ReasoningSelector } from './ReasoningSelector';

export interface ComposerMetadataValue {
  difficulty: QuestionDifficulty;
  reasoningLevel: ReasoningLevel;
  primaryTopicId: string;
  secondaryTopicIds: string[];
  description: string;
}

interface ComposerMetadataFieldsProps {
  value: ComposerMetadataValue;
  topics: Topic[];
  topicsLoading?: boolean;
  disabled?: boolean;
  /** In variant mode the primary topic is inherited from the source and shown read-only. */
  primaryTopicReadOnly?: boolean;
  primaryTopicName?: string;
  errors?: { primaryTopic?: string };
  onDifficultyChange: (value: QuestionDifficulty) => void;
  onReasoningChange: (value: ReasoningLevel) => void;
  onPrimaryTopicChange: (value: string) => void;
  onSecondaryTopicsChange: (value: string[]) => void;
  onDescriptionChange: (value: string) => void;
}

export function ComposerMetadataFields({
  value,
  topics,
  topicsLoading = false,
  disabled = false,
  primaryTopicReadOnly = false,
  primaryTopicName,
  errors,
  onDifficultyChange,
  onReasoningChange,
  onPrimaryTopicChange,
  onSecondaryTopicsChange,
  onDescriptionChange,
}: ComposerMetadataFieldsProps) {
  const topicOptions = topics.map((t) => ({ value: t.id.toString(), label: t.name }));
  const secondaryOptions = topics
    .filter((t) => t.id.toString() !== value.primaryTopicId)
    .map((t) => ({ value: t.id.toString(), label: t.name }));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_3fr]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="composer-difficulty" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Difficulty</Label>
          <DifficultySlider
            id="composer-difficulty"
            value={value.difficulty}
            onChange={onDifficultyChange}
            disabled={disabled}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="composer-reasoning" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Reasoning level</Label>
          <ReasoningSelector
            id="composer-reasoning"
            value={value.reasoningLevel}
            onChange={onReasoningChange}
            disabled={disabled}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Primary topic <span className="text-destructive">*</span>
        </Label>
        {primaryTopicReadOnly ? (
          <p className="py-2.5 text-sm text-muted-foreground">{primaryTopicName ?? `Topic ${value.primaryTopicId}`}</p>
        ) : (
          <>
            <Combobox
              options={topicOptions}
              value={value.primaryTopicId || null}
              onValueChange={(v) => onPrimaryTopicChange(v ?? '')}
              placeholder={topicsLoading ? 'Loading topics…' : topics.length === 0 ? 'No topics available' : 'Select primary topic'}
              searchPlaceholder="Search topics…"
              emptyText="No topics found"
              disabled={disabled || topics.length === 0}
            />
            {topics.length === 0 && !topicsLoading && (
              <p className="text-xs text-muted-foreground">No topics yet. Add them in Core, then re-sync.</p>
            )}
            {errors?.primaryTopic && <p className="text-xs text-destructive">{errors.primaryTopic}</p>}
          </>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Secondary topics <span className="font-normal normal-case text-muted-foreground">(optional)</span>
        </Label>
        <MultiSelect
          options={secondaryOptions}
          value={value.secondaryTopicIds}
          onValueChange={onSecondaryTopicsChange}
          placeholder="Select secondary topics"
          searchPlaceholder="Search topics…"
          emptyText="No topics"
          disabled={disabled}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="composer-description" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Description / label <span className="font-normal normal-case text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="composer-description"
          placeholder="Short label for this question"
          value={value.description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          disabled={disabled}
          className="h-11"
        />
      </div>
    </div>
  );
}
