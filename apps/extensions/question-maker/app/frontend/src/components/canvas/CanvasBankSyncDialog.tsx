/**
 * Dialog to sync a Classic Canvas Assessment Question Bank into a local course bank.
 * One-way Canvas → EduAI; re-sync upserts by Canvas question id.
 */
import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Button,
  Label,
  Input,
} from '@eduai/ui';
import { toast } from 'sonner';
import { useQmPermissionsForCourse } from '@/hooks/useQmPermissions';
import canvasService, {
  CanvasCourse,
  CanvasIntegration,
  CanvasQuestionBank,
} from '../../services/canvasService';
import { courseService } from '../../services/courseService';
import { questionBankService, QuestionBank } from '../../services/questionBankService';
import { Topic } from '../../types/topic';

interface CanvasBankSyncDialogProps {
  open: boolean;
  onClose: () => void;
  localCourseId: number | null;
  selectedLocalBankId?: string | null;
  onSyncSuccess?: (result: {
    bankId: string;
    created: number;
    updated: number;
    skipped: number;
  }) => void;
}

export const CanvasBankSyncDialog = ({
  open,
  onClose,
  localCourseId,
  selectedLocalBankId = null,
  onSyncSuccess,
}: CanvasBankSyncDialogProps) => {
  const { canManageCanvas } = useQmPermissionsForCourse(localCourseId);
  const [integration, setIntegration] = useState<CanvasIntegration | null>(null);
  const [canvasCourses, setCanvasCourses] = useState<CanvasCourse[]>([]);
  const [banks, setBanks] = useState<CanvasQuestionBank[]>([]);
  const [localBanks, setLocalBanks] = useState<QuestionBank[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);

  const [selectedCanvasCourseId, setSelectedCanvasCourseId] = useState('');
  const [selectedCanvasBankId, setSelectedCanvasBankId] = useState('');
  const [selectedTopicId, setSelectedTopicId] = useState('');
  const [targetBankId, setTargetBankId] = useState<string>('__new__');

  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingCourses, setIsLoadingCourses] = useState(false);
  const [isLoadingBanks, setIsLoadingBanks] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [showConnectForm, setShowConnectForm] = useState(false);
  const [canvasUrl, setCanvasUrl] = useState('');
  const [apiKey, setApiKey] = useState('');

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const status = await canvasService.getIntegration();
      setIntegration(status);
      if (status?.isConnected) {
        await loadCanvasCourses();
      } else {
        setShowConnectForm(true);
      }
    })();
  }, [open]);

  useEffect(() => {
    if (!open || !localCourseId) return;
    void (async () => {
      const [topicList, bankList] = await Promise.all([
        courseService.getCourseTopics(localCourseId),
        questionBankService.listBanks(localCourseId),
      ]);
      setTopics(topicList);
      setLocalBanks(bankList);
      if (selectedLocalBankId) {
        setTargetBankId(String(selectedLocalBankId));
      }
      if (topicList[0]) {
        setSelectedTopicId(String(topicList[0].id));
      }
    })();
  }, [open, localCourseId, selectedLocalBankId]);

  useEffect(() => {
    if (!selectedCanvasCourseId || !integration?.isConnected) {
      setBanks([]);
      setSelectedCanvasBankId('');
      return;
    }
    void loadCanvasBanks(Number(selectedCanvasCourseId));
  }, [selectedCanvasCourseId, integration]);

  const loadCanvasCourses = async () => {
    setIsLoadingCourses(true);
    try {
      const courses = await canvasService.getCourses();
      setCanvasCourses(courses);
    } catch (error: any) {
      toast.error('Failed to load Canvas courses', {
        description: error?.response?.data?.error || error.message,
      });
    } finally {
      setIsLoadingCourses(false);
    }
  };

  const loadCanvasBanks = async (canvasCourseId: number) => {
    setIsLoadingBanks(true);
    try {
      const list = await canvasService.getQuestionBanks(canvasCourseId);
      setBanks(list);
    } catch (error: any) {
      toast.error('Failed to load Canvas banks', {
        description: error?.response?.data?.error || error.message,
      });
      setBanks([]);
    } finally {
      setIsLoadingBanks(false);
    }
  };

  const handleConnect = async () => {
    if (!canvasUrl) {
      toast.error('Canvas URL required', {
        description: 'Please enter your Canvas instance URL.',
      });
      return;
    }

    if (!apiKey) {
      toast.error('API Key required', {
        description: 'Please enter your Canvas API key.',
      });
      return;
    }

    setIsConnecting(true);
    try {
      const { integration: result, usedTestMode } = await canvasService.connectCanvasWithFallback(
        canvasUrl,
        apiKey,
      );
      setIntegration(result);
      setShowConnectForm(false);
      if (usedTestMode) {
        toast('Canvas test mode', {
          description: 'Using mock Canvas data because live credentials were unavailable.',
        });
      }
      await loadCanvasCourses();
    } catch (error: any) {
      toast.error('Connection failed', {
        description: error?.response?.data?.error || error.message,
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleSync = async () => {
    if (!localCourseId || !selectedCanvasCourseId || !selectedCanvasBankId || !selectedTopicId) {
      toast.error('Missing fields', {
        description: 'Select Canvas course, bank, and a local topic.',
      });
      return;
    }
    setIsLoading(true);
    try {
      const result = await canvasService.importQuestionBank(
        Number(selectedCanvasCourseId),
        Number(selectedCanvasBankId),
        localCourseId,
        {
          primaryTopicId: selectedTopicId,
          targetBankId: targetBankId === '__new__' ? undefined : targetBankId,
        },
      );
      toast('Bank synced', {
        description: `Created ${result.created}, updated ${result.updated}, skipped ${result.skipped}`,
      });
      onSyncSuccess?.(result);
      onClose();
    } catch (error: any) {
      toast.error('Sync failed', {
        description: error?.response?.data?.error || error.message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const canSync =
    integration?.isConnected &&
    !showConnectForm &&
    selectedCanvasCourseId &&
    selectedCanvasBankId &&
    selectedTopicId &&
    !isLoading;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] flex flex-col overflow-hidden p-0 gap-0" data-testid="canvas-bank-sync-dialog">
        <DialogHeader className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-border">
          <DialogTitle>Sync question bank from Canvas</DialogTitle>
          <DialogDescription>
            One-way import from Classic Canvas Assessment Question Banks into EduAI.
            Re-sync updates existing questions without duplicates.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {!canManageCanvas ? (
            <p className="text-sm text-muted-foreground">
              Canvas bank sync is available to instructors and administrators only.
            </p>
          ) : showConnectForm ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="canvas-url">Canvas Instance URL</Label>
                <Input
                  id="canvas-url"
                  value={canvasUrl}
                  onChange={(e) => setCanvasUrl(e.target.value)}
                  placeholder="https://canvas.ubc.ca"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="canvas-key">API Key</Label>
                <Input
                  id="canvas-key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Enter your Canvas API key"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Canvas course</Label>
                {isLoadingCourses ? (
                  <div className="text-sm text-muted-foreground">Loading courses...</div>
                ) : (
                  <Select value={selectedCanvasCourseId} onValueChange={setSelectedCanvasCourseId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select course" />
                    </SelectTrigger>
                    <SelectContent>
                      {canvasCourses.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.course_code ? `${c.course_code} - ` : ''}{c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="space-y-2">
                <Label>Canvas question bank</Label>
                {isLoadingBanks ? (
                  <div className="text-sm text-muted-foreground">Loading banks...</div>
                ) : (
                  <Select
                    value={selectedCanvasBankId}
                    onValueChange={setSelectedCanvasBankId}
                    disabled={!selectedCanvasCourseId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select bank" />
                    </SelectTrigger>
                    <SelectContent>
                      {banks.map((b) => (
                        <SelectItem key={b.id} value={String(b.id)}>
                          {b.title || b.name || `Bank ${b.id}`}
                          {b.question_count != null ? ` (${b.question_count})` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="space-y-2">
                <Label>Local topic</Label>
                <Select value={selectedTopicId} onValueChange={setSelectedTopicId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select topic" />
                  </SelectTrigger>
                  <SelectContent>
                    {topics.map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Destination local bank</Label>
                <Select value={targetBankId} onValueChange={setTargetBankId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__new__">Create bank from Canvas name</SelectItem>
                    {localBanks.map((b) => (
                      <SelectItem key={b.id} value={String(b.id)}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-shrink-0 border-t border-border px-6 py-4 flex-row gap-2 sm:justify-between">
          {!canManageCanvas ? (
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          ) : showConnectForm ? (
            <>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleConnect} disabled={isConnecting || !canvasUrl || !apiKey}>
                {isConnecting ? 'Connecting...' : 'Connect Canvas'}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setShowConnectForm(true);
                  setSelectedCanvasCourseId('');
                  setSelectedCanvasBankId('');
                }}
              >
                Change Connection
              </Button>
              <Button onClick={handleSync} disabled={!canSync} data-testid="sync-bank-submit">
                {isLoading ? 'Syncing...' : 'Sync bank'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
