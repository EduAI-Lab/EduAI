/**
 * Assessment variant workflow: mark reference exam, blueprint snapshot, assemble one variant exam.
 */
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { useToast } from '../ui/use-toast';
import assessmentVariantService, { type BlueprintSnapshot } from '../../services/assessmentVariantService';

type BlueprintConfig = { studyRole?: string; referenceAssessmentId?: number } | null | undefined;

interface AssessmentVariantWorkflowPanelProps {
  assessmentId: number;
  courseId: number;
  assessmentName: string;
  blueprintConfig?: BlueprintConfig;
  onAssessmentRefresh: () => Promise<void>;
}

export const AssessmentVariantWorkflowPanel = ({
  assessmentId,
  courseId,
  assessmentName,
  blueprintConfig,
  onAssessmentRefresh
}: AssessmentVariantWorkflowPanelProps) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = React.useState<BlueprintSnapshot | null>(null);
  const [loadingSnapshot, setLoadingSnapshot] = React.useState(false);
  const [assembling, setAssembling] = React.useState(false);
  const [lastAssembledIds, setLastAssembledIds] = React.useState<number[]>([]);

  const studyRole = blueprintConfig?.studyRole ?? null;

  const handleMarkReference = async () => {
    try {
      await assessmentVariantService.setStudyRole(assessmentId, 'reference_baseline');
      await onAssessmentRefresh();
      toast({
        title: 'Reference baseline updated',
        description: 'This assessment is marked as the reference baseline for the assessment variant workflow.'
      });
    } catch (e: unknown) {
      toast({
        title: 'Failed to update',
        description: (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Please try again.',
        variant: 'destructive'
      });
    }
  };

  const handleClearRole = async () => {
    try {
      await assessmentVariantService.setStudyRole(assessmentId, null);
      await onAssessmentRefresh();
      toast({ title: 'Workflow role cleared' });
    } catch (e: unknown) {
      toast({
        title: 'Failed to update',
        description: (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Please try again.',
        variant: 'destructive'
      });
    }
  };

  const handleLoadSnapshot = async () => {
    try {
      setLoadingSnapshot(true);
      const data = await assessmentVariantService.getBlueprintSnapshot(assessmentId);
      setSnapshot(data);
    } catch (e: unknown) {
      toast({
        title: 'Snapshot failed',
        description: (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Please try again.',
        variant: 'destructive'
      });
    } finally {
      setLoadingSnapshot(false);
    }
  };

  const handleAssemble = async () => {
    try {
      setAssembling(true);
      const result = await assessmentVariantService.assembleEquivalentExams({
        referenceAssessmentId: assessmentId,
        courseId,
        namePrefix: assessmentName,
        examLabels: ['Variant exam'],
        includeDrafts: false
      });
      const ids = result.createdAssessments.map((a) => a.id);
      setLastAssembledIds(ids);
      toast({
        title: 'Variant exam created',
        description: `${result.examCount} exam(s) in ${result.assemblyTimeMs} ms. ${result.warnings.length ? `${result.warnings.length} warning(s) — see panel.` : ''}`
      });
      if (result.warnings.length > 0) {
        console.warn('Assessment variant workflow assembly warnings', result.warnings);
      }
    } catch (e: unknown) {
      toast({
        title: 'Assembly failed',
        description: (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Need ≥2 reviewed variants per slot where possible.',
        variant: 'destructive'
      });
    } finally {
      setAssembling(false);
    }
  };

  return (
    <Card className="border-dashed border-amber-200/80 bg-amber-50/40">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="h-5 w-5 text-amber-800" aria-hidden />
          <CardTitle className="text-base text-amber-950">Assessment variant workflow</CardTitle>
          {studyRole === 'reference_baseline' && (
            <Badge className="bg-amber-700 text-white hover:bg-amber-700">Reference baseline</Badge>
          )}
          {studyRole === 'generated_variant' && (
            <Badge variant="secondary">Generated variant</Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Mark an imported exam as ground truth, then assemble one variant exam from the question bank.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={handleMarkReference}>
            Mark as reference baseline
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={handleClearRole}>
            Clear workflow role
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={handleLoadSnapshot} disabled={loadingSnapshot}>
            {loadingSnapshot ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading…
              </>
            ) : (
              'Load blueprint snapshot'
            )}
          </Button>
        </div>

        {snapshot && (
          <div className="rounded-md border border-amber-200 bg-white p-3 text-sm">
            <p className="font-medium text-gray-900">{snapshot.slotCount} slots</p>
            <p className="text-muted-foreground">
              Difficulty: {JSON.stringify(snapshot.aggregates.difficultyCounts)} · Types:{' '}
              {JSON.stringify(snapshot.aggregates.typeCounts)}
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2 border-t border-amber-200/60 pt-3">
          <Button type="button" size="sm" onClick={handleAssemble} disabled={assembling}>
            {assembling ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Assembling…
              </>
            ) : (
              'Assemble variant exam'
            )}
          </Button>
          {lastAssembledIds.length > 0 && (
            <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
              Created:
              {lastAssembledIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="underline-offset-2 hover:underline"
                  onClick={() => navigate(`/assessments/${id}/builder`)}
                >
                  #{id}
                </button>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
