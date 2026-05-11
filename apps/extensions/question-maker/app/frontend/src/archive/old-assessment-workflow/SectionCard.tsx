/**
 * Card showing an assessment section with variant count, draft warnings, and edit/delete actions.
 * Provides hooks for editing the section or removing individual variants.
 */
import { AlertTriangle, Trash2 } from 'lucide-react';
import { AssessmentSection, SectionVariantLink } from '../../types/question';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';

interface SectionCardProps {
  section: AssessmentSection;
  onEdit: (section: AssessmentSection) => void;
  onDelete: (section: AssessmentSection) => void;
  onDeleteVariant: (sectionId: number, variantId: number) => void;
  id?: string;
}

export const SectionCard = ({
  section,
  onEdit,
  onDelete,
  onDeleteVariant,
  id
}: SectionCardProps) => {
  const questionCount = section.sectionVariants?.length ?? 0;

  // Check if this section has any draft questions
  const hasDraftQuestions = section.sectionVariants?.some(
    (link) => link.variant?.isDraft === true
  ) ?? false;

  return (
    <Card className="border border-gray-200" id={id}>
      <CardHeader className="flex flex-col gap-3 space-y-0 pb-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col">
          <div className="flex items-center gap-2">
            <CardTitle className="text-lg">{section.name || 'Section'}</CardTitle>
            {hasDraftQuestions && (
              <Badge variant="default" className="bg-amber-100 text-amber-800 hover:bg-amber-200 border-amber-300 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Contains Draft questions
              </Badge>
            )}
          </div>
          {section.sectionType && (
            <p className="text-sm text-muted-foreground capitalize">{section.sectionType}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            {questionCount} question{questionCount === 1 ? '' : 's'}
          </Badge>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={() => onEdit(section)}>
              Edit
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onDelete(section)}>
              Delete
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {section.description && (
          <p className="text-sm text-muted-foreground">{section.description}</p>
        )}

        <div className="rounded border border-gray-100 bg-gray-50 p-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Questions
          </h4>
          {questionCount > 0 ? (
            <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
              {(section.sectionVariants ?? [])
                .slice()
                .sort((a, b) => a.displayOrder - b.displayOrder)
                .map((link: SectionVariantLink) => (
                  <div
                    key={link.id}
                    className="flex items-center justify-between gap-2 rounded border border-gray-200 bg-white p-2 text-sm text-gray-700"
                  >
                    <span className="flex-1">{link.variant?.questionText ?? 'Untitled question'}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (link.variantId) {
                          onDeleteVariant(section.id, link.variantId);
                        }
                      }}
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
            </div>
          ) : (
            <div className="rounded border border-dashed border-gray-200 p-4 text-center text-sm text-muted-foreground">
              No questions yet. Add some when configuring this section.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
