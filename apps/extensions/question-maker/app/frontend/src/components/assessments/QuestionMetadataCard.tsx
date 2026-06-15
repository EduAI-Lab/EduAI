/**
 * Displays question metadata with variant tabs, topic labels, and review toggles.
 * Lets users select a question, add variants, and change draft status inline.
 */
import { Button, Badge, Tabs, TabsList, TabsTrigger, TabsContent } from '@eduai/ui';

import { useState, useEffect } from 'react';
import { Question, QuestionVariant } from '../../types/question';
import { Topic } from '../../types/topic';

interface QuestionMetadataCardProps {
  question: Question;
  isSelected: boolean;
  onToggleSelection: () => void;
  onAddVariant: () => void;
  topicsById: Record<number, Topic>;
  onToggleReview?: (variantId: number, nextDraft: boolean) => void;
  onViewQuestion?: (question: Question, variantId?: number) => void;
  selectedVariantId?: number;
  onVariantChange?: (questionId: number, variantId: number) => void;
}

const getTopicName = (topicsById: Record<number, Topic>, topicId?: number | null) => {
  if (!topicId) return 'Unassigned topic';
  const topic = topicsById[topicId];
  return topic ? topic.name : `Topic #${topicId}`;
};

const getDifficultyColor = (difficulty: string) => {
  switch (difficulty) {
    case 'easy':
      return 'bg-green-100 text-green-800 border-green-200';
    case 'medium':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'hard':
      return 'bg-red-100 text-red-800 border-red-200';
    default:
      return 'bg-muted text-foreground border-border';
  }
};

const getReasoningColor = (reasoning: string) => {
  switch (reasoning) {
    case 'factual':
      return 'bg-secondary/15 text-secondary border-secondary/30';
    case 'analytical':
      return 'bg-purple-100 text-purple-800 border-purple-200';
    case 'application':
      return 'bg-indigo-100 text-indigo-800 border-indigo-200';
    default:
      return 'bg-muted text-foreground border-border';
  }
};

export const QuestionMetadataCard = ({
  question,
  isSelected,
  onToggleSelection,
  onAddVariant,
  topicsById,
  onToggleReview,
  onViewQuestion,
  selectedVariantId,
  onVariantChange
}: QuestionMetadataCardProps) => {
  const variants = question.variants || [];
  // Use selectedVariantId from parent if provided, otherwise default to first variant
  const defaultVariantId = selectedVariantId ?? variants[0]?.id ?? 0;
  const [activeVariantId, setActiveVariantId] = useState<number>(defaultVariantId);

  // Sync with parent's selectedVariantId when it changes
  useEffect(() => {
    if (selectedVariantId !== undefined && selectedVariantId !== activeVariantId) {
      setActiveVariantId(selectedVariantId);
    }
  }, [selectedVariantId, activeVariantId]);

  const activeVariant = variants.find((v) => v.id === activeVariantId) || variants[0];

  const handleVariantChange = (variantId: number) => {
    setActiveVariantId(variantId);
    if (onVariantChange && isSelected) {
      onVariantChange(question.id, variantId);
    }
  };

  const secondaryTopicNames = Array.from(
    new Set(
      variants.flatMap((variant) => variant.secondaryTopicsId ?? [])
    )
  )
    .map((topicId) => topicsById[topicId]?.name)
    .filter(Boolean) as string[];

  if (variants.length === 0) {
    return null;
  }

  return (
    <div
      className={`rounded border ${
        isSelected ? 'border-primary bg-primary/5' : 'border-border'
      } overflow-hidden`}
    >
      {/* Header with metadata info and selection */}
      <div
        onClick={onToggleSelection}
        className="flex items-start gap-3 px-3 py-3 cursor-pointer hover:bg-muted"
      >
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelection}
          onClick={(e) => e.stopPropagation()}
          className="mt-1 h-4 w-4 rounded border-border cursor-pointer"
        />
        <div className="flex-1 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="secondary" className="text-xs">
                  {question.type}
                </Badge>
                {variants.length > 1 && (
                  <Badge variant="outline" className="text-xs">
                    {variants.length} variants
                  </Badge>
                )}
                {activeVariant && activeVariant.isDraft !== undefined && (
                  <Badge
                    variant="default"
                    className={
                      activeVariant.isDraft
                        ? 'bg-amber-100 text-amber-800 border-amber-200'
                        : 'bg-green-100 text-green-800 border-green-200'
                    }
                  >
                    {activeVariant.isDraft ? 'Draft' : 'Reviewed'}
                  </Badge>
                )}
                {activeVariant && activeVariant.isAiGenerated && (
                  <Badge variant="outline" className="text-xs border-purple-200 text-purple-800">
                    AI
                  </Badge>
                )}
              </div>
              {question.description && (
                <p className="text-sm font-medium text-foreground mb-1">
                  {question.description}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Primary: {getTopicName(topicsById, question.primaryTopicId)}
              </p>
              {secondaryTopicNames.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Secondary: {secondaryTopicNames.join(', ')}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {onViewQuestion && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewQuestion(question, activeVariant?.id);
                  }}
                  className="text-xs"
                >
                  View Question
                </Button>
              )}
              {onToggleReview && activeVariant && activeVariant.isDraft !== undefined && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleReview(activeVariant.id, !activeVariant.isDraft);
                  }}
                  className="text-xs"
                >
                  {activeVariant.isDraft ? 'Mark Reviewed' : 'Mark Draft'}
                </Button>
              )}
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddVariant();
                }}
                className="text-xs bg-primary text-primary-foreground hover:bg-primary/90"
              >
                + Variant
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Variant Tabs */}
      {variants.length > 1 ? (
        <Tabs
          value={activeVariantId.toString()}
          onValueChange={(value) => handleVariantChange(Number(value))}
          className="w-full"
        >
          <div className="border-t border-border bg-muted px-3 py-2">
            <TabsList className="h-8 bg-card">
              {variants.map((variant, index) => (
                <TabsTrigger
                  key={variant.id}
                  value={variant.id.toString()}
                  className="text-xs px-3 h-7"
                >
                  Variant {index + 1}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          {variants.map((variant) => (
            <TabsContent
              key={variant.id}
              value={variant.id.toString()}
              className="mt-0 px-3 py-3 border-t border-border bg-card"
            >
              <VariantContent variant={variant} />
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        <div className="px-3 py-3 border-t border-border bg-card">
          <VariantContent variant={activeVariant} />
        </div>
      )}
    </div>
  );
};

const VariantContent = ({ variant }: { variant: QuestionVariant }) => {
  const hasChoices = variant.choices && Array.isArray(variant.choices) && variant.choices.length > 0;

  return (
    <div className="space-y-2">
      <p className="text-sm text-foreground">{variant.questionText}</p>
      {hasChoices && variant.choices && (
        <div className="mt-2 space-y-1.5">
          {variant.choices.map((choice, index) => {
            const isCorrect = variant.answer && choice.letter === variant.answer.trim().toUpperCase();
            return (
              <div
                key={index}
                className={`text-xs flex items-start gap-2 p-2 rounded ${
                  isCorrect ? 'bg-emerald-50 border border-emerald-200' : 'bg-muted border border-border'
                }`}
              >
                <span className={`font-semibold shrink-0 ${isCorrect ? 'text-emerald-700' : 'text-muted-foreground'}`}>
                  {choice.letter})
                </span>
                <span className={isCorrect ? 'text-emerald-900 font-medium' : 'text-foreground'}>
                  {choice.text}
                </span>
                {isCorrect && (
                  <span className="ml-auto text-xs font-semibold text-emerald-700">✓</span>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${getDifficultyColor(
            variant.difficulty
          )}`}
        >
          {variant.difficulty.charAt(0).toUpperCase() + variant.difficulty.slice(1)}
        </span>
        {variant.reasoningLevel && (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${getReasoningColor(
              variant.reasoningLevel
            )}`}
          >
            {variant.reasoningLevel.charAt(0).toUpperCase() + variant.reasoningLevel.slice(1)}
          </span>
        )}
      </div>
      {variant.assessment && (
        <div className="mt-2 pt-2 border-t border-border">
          <p className="text-xs text-muted-foreground">
            Previously used in:{' '}
            <span className="font-medium text-foreground">
              {variant.assessment.name} ({variant.assessment.semester})
            </span>
          </p>
        </div>
      )}
    </div>
  );
};
