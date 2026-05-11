/**
 * Dialog for exporting an assessment to Canvas, handling integration setup and course selection.
 * Validates inputs, triggers export, and surfaces success/error toasts.
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
import canvasService, { CanvasCourse, CanvasIntegration } from '../../services/canvasService';

interface CanvasExportDialogProps {
  open: boolean;
  onClose: () => void;
  assessmentId: number;
  assessmentName: string;
  onExportSuccess?: (result: { quizId: number; canvasUrl: string }) => void;
}

export const CanvasExportDialog = ({
  open,
  onClose,
  assessmentId,
  assessmentName,
  onExportSuccess
}: CanvasExportDialogProps) => {
  const { toast } = useToast();
  const [integration, setIntegration] = useState<CanvasIntegration | null>(null);
  const [courses, setCourses] = useState<CanvasCourse[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingCourses, setIsLoadingCourses] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  
  // Connection form state
  const [showConnectForm, setShowConnectForm] = useState(false);
  const [canvasUrl, setCanvasUrl] = useState('');
  const [apiKey, setApiKey] = useState('');

  // Load integration status and courses
  useEffect(() => {
    if (open) {
      loadIntegration();
    }
  }, [open]);

  const loadIntegration = async () => {
    try {
      const integrationData = await canvasService.getIntegration();
      setIntegration(integrationData);
      
      if (integrationData?.isConnected) {
        await loadCourses();
      } else {
        setShowConnectForm(true);
      }
    } catch (error) {
      console.error('Failed to load Canvas integration:', error);
    }
  };

  const loadCourses = async () => {
    setIsLoadingCourses(true);
    try {
      const canvasCourses = await canvasService.getCourses();
      setCourses(canvasCourses);
    } catch (error: any) {
      toast({
        title: 'Failed to load Canvas courses',
        description: error.response?.data?.error || 'Please check your Canvas connection.',
        variant: 'destructive'
      });
    } finally {
      setIsLoadingCourses(false);
    }
  };

  const handleConnect = async () => {
    if (!canvasUrl) {
      toast({
        title: 'Canvas URL required',
        description: 'Please enter your Canvas instance URL.',
        variant: 'destructive'
      });
      return;
    }

    if (!apiKey) {
      toast({
        title: 'API Key required',
        description: 'Please enter your Canvas API key.',
        variant: 'destructive'
      });
      return;
    }

    setIsConnecting(true);
    try {
      const result = await canvasService.connectCanvas(canvasUrl, apiKey, false);
      setIntegration(result);
      setShowConnectForm(false);
      await loadCourses();
    } catch (error: any) {
      toast({
        title: 'Failed to connect Canvas',
        description: error.response?.data?.error || 'Please check your credentials and try again.',
        variant: 'destructive'
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleExport = async () => {
    if (!selectedCourseId) {
      toast({
        title: 'Course required',
        description: 'Please select a Canvas course to export to.',
        variant: 'destructive'
      });
      return;
    }

    setIsLoading(true);
    try {
      const result = await canvasService.exportAssessment(assessmentId, parseInt(selectedCourseId));
      
      toast({
        title: 'Export successful!',
        description: `Assessment exported to Canvas. ${result.questionsCreated} questions created.`,
      });

      if (onExportSuccess) {
        onExportSuccess({
          quizId: result.quizId,
          canvasUrl: result.canvasUrl
        });
      }

      onClose();
    } catch (error: any) {
      toast({
        title: 'Export failed',
        description: error.response?.data?.error || 'Failed to export assessment to Canvas.',
        variant: 'destructive'
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Export to Canvas LMS</DialogTitle>
          <DialogDescription>
            Export "{assessmentName}" to a Canvas course as a quiz.
          </DialogDescription>
        </DialogHeader>

        {showConnectForm ? (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="canvasUrl">Canvas Instance URL</Label>
              <Input
                id="canvasUrl"
                placeholder="https://canvas.instructure.com"
                value={canvasUrl}
                onChange={(e) => setCanvasUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Your Canvas LMS instance URL (e.g., https://canvas.ubc.ca)
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="apiKey">API Key</Label>
              <Input
                id="apiKey"
                type="password"
                placeholder="Enter your Canvas API key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Generate an API key from your Canvas account settings
              </p>
            </div>

            <Button
              onClick={handleConnect}
              disabled={isConnecting || !canvasUrl || !apiKey}
              className="w-full"
            >
              {isConnecting ? 'Connecting...' : 'Connect Canvas'}
            </Button>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="canvasCourse">Select Canvas Course</Label>
              {isLoadingCourses ? (
                <div className="text-sm text-muted-foreground">Loading courses...</div>
              ) : courses.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No courses found. Make sure you are enrolled as an instructor.
                </div>
              ) : (
                <Select value={selectedCourseId} onValueChange={setSelectedCourseId}>
                  <SelectTrigger id="canvasCourse">
                    <SelectValue placeholder="Select a course" />
                  </SelectTrigger>
                  <SelectContent>
                    {courses.map((course) => (
                      <SelectItem key={course.id} value={course.id.toString()}>
                        {course.course_code ? `${course.course_code} - ` : ''}{course.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="flex items-center justify-between pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowConnectForm(true);
                  setSelectedCourseId('');
                }}
              >
                Change Connection
              </Button>
              <Button
                onClick={handleExport}
                disabled={isLoading || !selectedCourseId || courses.length === 0}
              >
                {isLoading ? 'Exporting...' : 'Export to Canvas'}
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CanvasExportDialog;
