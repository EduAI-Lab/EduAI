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
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { useToast } from '../ui/use-toast';
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
  selectedLocalBankId?: number | null;
  onSyncSuccess?: (result: {
    bankId: number;
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
  onSyncSuccess
}: CanvasBankSyncDialogProps) => {
  const { toast } = useToast();
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
        const courses = await canvasService.getCourses();
        setCanvasCourses(courses);
      }
    })();
  }, [open]);

  useEffect(() => {
    if (!open || !localCourseId) return;
    void (async () => {
      const [topicList, bankList] = await Promise.all([
        courseService.getCourseTopics(localCourseId),
        questionBankService.listBanks(localCourseId)
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
      return;
    }
    void (async () => {
      try {
        const list = await canvasService.listCanvasBanks(Number(selectedCanvasCourseId));
        setBanks(list);
      } catch (error: any) {
        toast({
          title: 'Failed to load Canvas banks',
          description: error?.response?.data?.error || error.message,
          variant: 'destructive'
        });
      }
    })();
  }, [selectedCanvasCourseId, integration]);

  const handleConnect = async (testMode: boolean) => {
    setIsConnecting(true);
    try {
      const result = await canvasService.connectCanvas(
        testMode ? 'https://canvas.test' : canvasUrl,
        testMode ? 'test-key' : apiKey,
        testMode
      );
      setIntegration(result);
      setShowConnectForm(false);
      const courses = await canvasService.getCourses();
      setCanvasCourses(courses);
      toast({ title: 'Canvas connected' });
    } catch (error: any) {
      toast({
        title: 'Connection failed',
        description: error?.response?.data?.error || error.message,
        variant: 'destructive'
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleSync = async () => {
    if (!localCourseId || !selectedCanvasCourseId || !selectedCanvasBankId || !selectedTopicId) {
      toast({
        title: 'Missing fields',
        description: 'Select Canvas course, bank, and a local topic.',
        variant: 'destructive'
      });
      return;
    }
    setIsLoading(true);
    try {
      const result = await canvasService.syncCanvasBank(
        Number(selectedCanvasCourseId),
        Number(selectedCanvasBankId),
        localCourseId,
        {
          primaryTopicId: Number(selectedTopicId),
          targetBankId: targetBankId === '__new__' ? undefined : Number(targetBankId)
        }
      );
      toast({
        title: 'Bank synced',
        description: `Created ${result.created}, updated ${result.updated}, skipped ${result.skipped}`
      });
      onSyncSuccess?.(result);
      onClose();
    } catch (error: any) {
      toast({
        title: 'Sync failed',
        description: error?.response?.data?.error || error.message,
        variant: 'destructive'
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg" data-testid="canvas-bank-sync-dialog">
        <DialogHeader>
          <DialogTitle>Sync question bank from Canvas</DialogTitle>
          <DialogDescription>
            One-way import from Classic Canvas Assessment Question Banks into EduAI.
            Re-sync updates existing questions without duplicates.
          </DialogDescription>
        </DialogHeader>

        {!integration?.isConnected || showConnectForm ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Connect Canvas or use test mode.</p>
            <div className="space-y-2">
              <Label htmlFor="canvas-url">Canvas URL</Label>
              <Input
                id="canvas-url"
                value={canvasUrl}
                onChange={(e) => setCanvasUrl(e.target.value)}
                placeholder="https://canvas.ubc.ca"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="canvas-key">API key</Label>
              <Input
                id="canvas-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={() => handleConnect(false)} disabled={isConnecting}>
                Connect
              </Button>
              <Button variant="outline" onClick={() => handleConnect(true)} disabled={isConnecting}>
                Use test mode
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Canvas course</Label>
              <Select value={selectedCanvasCourseId} onValueChange={setSelectedCanvasCourseId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select course" />
                </SelectTrigger>
                <SelectContent>
                  {canvasCourses.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Canvas question bank</Label>
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

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {integration?.isConnected && !showConnectForm && (
            <Button onClick={handleSync} disabled={isLoading} data-testid="sync-bank-submit">
              {isLoading ? 'Syncing…' : 'Sync bank'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
