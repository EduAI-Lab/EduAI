/**
 * Card rendering a single question/variant summary with actions to view or create variants.
 * Displays metadata badges for type, difficulty, topic, AI status, and draft state.
 */
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { Eye, Copy } from 'lucide-react';
import { QuestionVariantEntry } from '../../types/question';

interface QuestionCardProps {
    entry: QuestionVariantEntry;
    questionNumber: number;
    onView: (entry: QuestionVariantEntry) => void;
    onCreateVariant: (entry: QuestionVariantEntry) => void;
}

export const QuestionCard = ({ entry, questionNumber, onView, onCreateVariant }: QuestionCardProps) => {
    const primaryTopicLabel = entry.primaryTopicName ?? `Topic ${entry.primaryTopicId}`;

    return (
        <Card className="hover:shadow-md transition-shadow">
            <CardContent className="px-6 pt-6 pb-6">
                <div className="flex items-start justify-between gap-6">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-3 mb-4">
                            <span className="text-sm font-medium text-gray-500">Q{questionNumber}</span>
                            <Badge variant="secondary" className="uppercase">
                                {entry.questionType}
                            </Badge>
                            <Badge variant="outline" className="capitalize">
                                {entry.variant.difficulty ?? 'medium'}
                            </Badge>
                            <Badge variant="outline">{primaryTopicLabel}</Badge>
                            {entry.isAiGenerated && (
                                <Badge variant="default" className="bg-purple-100 text-purple-800 hover:bg-purple-200 border-purple-300">
                                    AI Generated
                                </Badge>
                            )}
                            {entry.isDraft ? (
                                <Badge variant="default" className="bg-amber-100 text-amber-800 hover:bg-amber-200 border-amber-300">
                                    Draft
                                </Badge>
                            ) : (
                                <Badge variant="default" className="bg-green-100 text-green-800 hover:bg-green-200 border-green-300">
                                    Reviewed
                                </Badge>
                            )}
                        </div>

                        <div className="mb-3 space-y-2">
                            <p className="text-gray-900 line-clamp-2 leading-relaxed">
                                {entry.variant.questionText}
                            </p>
                            {entry.questionType === 'MCQ' && entry.variant.choices && entry.variant.choices.length > 0 && (
                                <div className="text-xs text-gray-600 space-y-1">
                                    {entry.variant.choices.slice(0, 2).map((choice, idx) => (
                                        <div key={idx} className="flex items-center gap-1.5">
                                            <span className="font-medium">{choice.letter})</span>
                                            <span className="line-clamp-1">{choice.text}</span>
                                        </div>
                                    ))}
                                    {entry.variant.choices.length > 2 && (
                                        <span className="text-muted-foreground">
                                            +{entry.variant.choices.length - 2} more options
                                        </span>
                                    )}
                                </div>
                            )}
                            <p className="text-xs text-muted-foreground line-clamp-1">
                                {entry.questionDescription}
                            </p>
                        </div>

                        <p className="text-xs text-gray-500">
                            Created: {new Date(entry.variant.createdAt || entry.variant.updatedAt || new Date().toISOString()).toLocaleDateString()}
                        </p>
                    </div>

                    <div className="flex items-center space-x-2 flex-shrink-0">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onView(entry)}
                            className="flex items-center space-x-1"
                        >
                            <Eye className="h-4 w-4" />
                            <span>View</span>
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onCreateVariant(entry)}
                            className="flex items-center space-x-1"
                        >
                            <Copy className="h-4 w-4" />
                            <span>Variant</span>
                        </Button>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};
