/**
 * Metadata fields for the Question Composer: difficulty, reasoning level, primary topic
 * (Combobox), secondary topics (MultiSelect), and an optional description/label.
 * Built for the full-page layout; uses @eduai/ui primitives + CSS vars only.
 *
 * The topic and description fields are also exported on their own so the create/variant
 * wizard can place them in its Details step.
 */
import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { Label, Input, Button, Combobox, HelpHint, MultiSelect } from "@eduai/ui";
import { QUESTION_MAKER_HELP } from "@/lib/helpHints";

import type { QuestionDifficulty, ReasoningLevel } from "../../types/question";
import type { Topic } from "../../types/topic";
import { DifficultySlider } from "./DifficultySlider";
import { ReasoningSelector } from "./ReasoningSelector";

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
  onCreateTopic?: (name: string) => Promise<Topic>;
}

const FIELD_LABEL_CLASS = "text-xs font-medium uppercase tracking-wider text-muted-foreground";

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
  onCreateTopic,
}: ComposerMetadataFieldsProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_3fr]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="composer-difficulty" className={FIELD_LABEL_CLASS}>
            Difficulty
          </Label>
          <DifficultySlider
            id="composer-difficulty"
            value={value.difficulty}
            onChange={onDifficultyChange}
            disabled={disabled}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="composer-reasoning" className={FIELD_LABEL_CLASS}>
            Reasoning level
          </Label>
          <ReasoningSelector
            id="composer-reasoning"
            value={value.reasoningLevel}
            onChange={onReasoningChange}
            disabled={disabled}
          />
        </div>
      </div>

      <PrimaryTopicField
        primaryTopicId={value.primaryTopicId}
        topics={topics}
        topicsLoading={topicsLoading}
        disabled={disabled}
        readOnly={primaryTopicReadOnly}
        readOnlyName={primaryTopicName}
        error={errors?.primaryTopic}
        onChange={onPrimaryTopicChange}
        onCreateTopic={onCreateTopic}
      />

      <SecondaryTopicsField
        primaryTopicId={value.primaryTopicId}
        secondaryTopicIds={value.secondaryTopicIds}
        topics={topics}
        disabled={disabled}
        onChange={onSecondaryTopicsChange}
      />

      <DescriptionField
        value={value.description}
        disabled={disabled}
        onChange={onDescriptionChange}
      />
    </div>
  );
}

interface PrimaryTopicFieldProps {
  primaryTopicId: string;
  topics: Topic[];
  topicsLoading?: boolean;
  disabled?: boolean;
  /** Variant mode: the topic is inherited from the source question. */
  readOnly?: boolean;
  readOnlyName?: string;
  /** Rendered before the read-only topic name (e.g. a lock icon). */
  readOnlyAdornment?: ReactNode;
  error?: string;
  onChange: (value: string) => void;
  onCreateTopic?: (name: string) => Promise<Topic>;
}

/** Primary topic Combobox plus the inline "Add topic" creator. */
export function PrimaryTopicField({
  primaryTopicId,
  topics,
  topicsLoading = false,
  disabled = false,
  readOnly = false,
  readOnlyName,
  readOnlyAdornment,
  error,
  onChange,
  onCreateTopic,
}: PrimaryTopicFieldProps) {
  const [newTopicName, setNewTopicName] = useState("");
  const [creatingTopic, setCreatingTopic] = useState(false);
  const [topicCreationError, setTopicCreationError] = useState<string | null>(null);
  const [showTopicCreator, setShowTopicCreator] = useState(false);

  const handleCreateTopic = async () => {
    const name = newTopicName.trim();
    if (!name || !onCreateTopic) return;

    setCreatingTopic(true);
    setTopicCreationError(null);
    try {
      const topic = await onCreateTopic(name);
      setNewTopicName("");
      onChange(topic.id);
      setShowTopicCreator(false);
    } catch (cause) {
      console.error("Failed to create topic", cause);
      setTopicCreationError("Could not create topic. Try a different name.");
    } finally {
      setCreatingTopic(false);
    }
  };

  const topicOptions = topics.map((t) => ({ value: t.id.toString(), label: t.name }));

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <Label className={FIELD_LABEL_CLASS}>
          Primary topic <span className="text-destructive">*</span>
        </Label>
        <HelpHint {...QUESTION_MAKER_HELP.topics} LinkComponent={Link} />
      </div>
      {readOnly ? (
        <p className="flex items-center gap-1.5 py-2.5 text-sm text-muted-foreground">
          {readOnlyAdornment}
          {readOnlyName ?? `Topic ${primaryTopicId}`}
        </p>
      ) : (
        <>
          <Combobox
            options={topicOptions}
            value={primaryTopicId || null}
            onValueChange={(v) => onChange(v ?? "")}
            placeholder={
              topicsLoading
                ? "Loading topics…"
                : topics.length === 0
                  ? "No topics available"
                  : "Select primary topic"
            }
            searchPlaceholder="Search topics…"
            emptyText="No topics found"
            disabled={disabled || topics.length === 0}
          />
          {topics.length === 0 && !topicsLoading && (
            <p className="text-xs text-muted-foreground">
              No topics yet. Add one below to continue.
            </p>
          )}
          {onCreateTopic && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                aria-expanded={showTopicCreator}
                aria-controls="composer-topic-creator"
                onClick={() => {
                  setShowTopicCreator((open) => !open);
                  setTopicCreationError(null);
                }}
                disabled={disabled || creatingTopic}
              >
                {showTopicCreator ? "Cancel" : "Add topic"}
              </Button>
              {showTopicCreator && (
                <div id="composer-topic-creator" className="flex gap-2">
                  <Input
                    value={newTopicName}
                    onChange={(event) => {
                      setNewTopicName(event.target.value);
                      if (topicCreationError) setTopicCreationError(null);
                    }}
                    placeholder="New topic name"
                    aria-label="New topic name"
                    disabled={disabled || creatingTopic}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void handleCreateTopic();
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleCreateTopic()}
                    disabled={disabled || creatingTopic || !newTopicName.trim()}
                  >
                    {creatingTopic ? "Adding…" : "Add"}
                  </Button>
                </div>
              )}
            </>
          )}
          {topicCreationError && <p className="text-xs text-destructive">{topicCreationError}</p>}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </>
      )}
    </div>
  );
}

interface SecondaryTopicsFieldProps {
  primaryTopicId: string;
  secondaryTopicIds: string[];
  topics: Topic[];
  disabled?: boolean;
  onChange: (value: string[]) => void;
}

export function SecondaryTopicsField({
  primaryTopicId,
  secondaryTopicIds,
  topics,
  disabled = false,
  onChange,
}: SecondaryTopicsFieldProps) {
  const secondaryOptions = topics
    .filter((t) => t.id.toString() !== primaryTopicId)
    .map((t) => ({ value: t.id.toString(), label: t.name }));
  return (
    <div className="flex flex-col gap-1.5">
      <Label className={FIELD_LABEL_CLASS}>
        Secondary topics{" "}
        <span className="font-normal normal-case text-muted-foreground">(optional)</span>
      </Label>
      <MultiSelect
        options={secondaryOptions}
        value={secondaryTopicIds}
        onValueChange={onChange}
        placeholder="Select secondary topics"
        searchPlaceholder="Search topics…"
        emptyText="No topics"
        disabled={disabled}
      />
    </div>
  );
}

interface DescriptionFieldProps {
  value: string;
  disabled?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
}

export function DescriptionField({
  value,
  disabled = false,
  placeholder = "Short label for this question",
  onChange,
}: DescriptionFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="composer-description" className={FIELD_LABEL_CLASS}>
        Description / label{" "}
        <span className="font-normal normal-case text-muted-foreground">(optional)</span>
      </Label>
      <Input
        id="composer-description"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="h-11"
      />
    </div>
  );
}
