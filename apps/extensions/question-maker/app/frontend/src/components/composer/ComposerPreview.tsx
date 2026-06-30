/**
 * Live preview for the Question Composer. Renders the in-progress form state with the
 * canonical @eduai/ui QuestionCard so authors see exactly how the question will appear.
 * Mirrors the mapping used by the course Questions tab wrapper (difficulty label,
 * correct-choice flagging, topic tags).
 */
import { QuestionCard, questionStatus } from '@eduai/ui';
import type { QuestionCardChoice, QuestionDifficulty as UiDifficulty } from '@eduai/ui';

import {
  questionTypeLabels,
  type QuestionType,
  type QuestionDifficulty,
  type MCQChoice,
} from '../../types/question';
import type { Topic } from '../../types/topic';

interface ComposerPreviewProps {
  questionType: QuestionType;
  difficulty: QuestionDifficulty;
  questionText: string;
  choices: MCQChoice[];
  answer: string;
  primaryTopicId: string;
  secondaryTopicIds: string[];
  topics: Topic[];
  /** Header label e.g. "New question" / "New variant" */
  label?: string;
  /** Mark the AI chip on the preview while/after generation. */
  ai?: boolean;
  isDraft?: boolean;
}

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export function ComposerPreview({
  questionType,
  difficulty,
  questionText,
  choices,
  answer,
  primaryTopicId,
  secondaryTopicIds,
  topics,
  label,
  ai = false,
  isDraft = true,
}: ComposerPreviewProps) {
  const topicName = (id: string) => topics.find((t) => t.id.toString() === id)?.name ?? `Topic ${id}`;
  const topicLabels = [
    ...(primaryTopicId ? [topicName(primaryTopicId)] : []),
    ...secondaryTopicIds.map(topicName),
  ];

  const previewChoices: QuestionCardChoice[] | undefined =
    questionType === 'MCQ'
      ? choices
          .filter((c) => c.text.trim().length > 0)
          .map((choice) => ({
            letter: choice.letter,
            text: choice.text,
            correct: answer !== '' && choice.letter === answer,
          }))
      : undefined;

  const hasChoices = Boolean(previewChoices && previewChoices.length > 0);

  return (
    <QuestionCard
      type={questionTypeLabels[questionType]}
      difficulty={capitalize(difficulty)}
      difficultyLevel={difficulty as UiDifficulty}
      ai={ai}
      label={label}
      status={questionStatus(isDraft)}
      question={
        questionText.trim() ? (
          questionText
        ) : (
          <span className="text-muted-foreground italic">Your question will appear here as you type…</span>
        )
      }
      choices={previewChoices}
      answer={!hasChoices && answer.trim() ? answer : undefined}
      topics={topicLabels}
    />
  );
}
