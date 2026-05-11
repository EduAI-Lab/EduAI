/**
 * Dialog for importing a Canvas quiz into a local assessment with topic selection.
 * Handles integration checks, course/quiz selection, and imports while reporting skips.
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
import canvasService, { CanvasCourse, CanvasIntegration, CanvasQuiz, CanvasSkippedQuestion } from '../../services/canvasService';
import { courseService } from '../../services/courseService';
import { Course } from '../../types/question';
import { Topic } from '../../types/topic';

interface CanvasImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImportSuccess?: (result: { assessmentId: number; assessmentName: string }) => void;
}

export const CanvasImportDialog = ({
  open,
  onClose,
  onImportSuccess
}: CanvasImportDialogProps) => {
  const { toast } = useToast();
  const [integration, setIntegration] = useState<CanvasIntegration | null>(null);
  const [canvasCourses, setCanvasCourses] = useState<CanvasCourse[]>([]);
  const [localCourses, setLocalCourses] = useState<Course[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [quizzes, setQuizzes] = useState<CanvasQuiz[]>([]);
  
  const [selectedCanvasCourseId, setSelectedCanvasCourseId] = useState<string>('');
  const [selectedQuizId, setSelectedQuizId] = useState<string>('');
  const [selectedLocalCourseId, setSelectedLocalCourseId] = useState<string>('');
  const [selectedTopicId, setSelectedTopicId] = useState<string>('');
  const [assessmentName, setAssessmentName] = useState<string>('');
  const [assessmentType, setAssessmentType] = useState<string>('Quiz');
  const [semester, setSemester] = useState<string>(() => {
    const now = new Date();
    return `Fall ${now.getFullYear()}`;
  });
  
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingCourses, setIsLoadingCourses] = useState(false);
  const [isLoadingQuizzes, setIsLoadingQuizzes] = useState(false);
  const [isLoadingTopics, setIsLoadingTopics] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  
  // Connection form state
  const [showConnectForm, setShowConnectForm] = useState(false);
  const [canvasUrl, setCanvasUrl] = useState('');
  const [apiKey, setApiKey] = useState('');

  // Load integration status
  useEffect(() => {
    if (open) {
      loadIntegration();
      loadLocalCourses();
    }
  }, [open]);

  // Load quizzes when Canvas course is selected
  useEffect(() => {
    if (selectedCanvasCourseId && integration?.isConnected) {
      loadQuizzes(parseInt(selectedCanvasCourseId));
    } else {
      setQuizzes([]);
      setSelectedQuizId('');
    }
  }, [selectedCanvasCourseId, integration]);

  // Load topics when local course is selected
  useEffect(() => {
    if (selectedLocalCourseId) {
      loadTopics(parseInt(selectedLocalCourseId));
    } else {
      setTopics([]);
      setSelectedTopicId('');
    }
  }, [selectedLocalCourseId]);

  // Update assessment name when quiz is selected
  useEffect(() => {
    if (selectedQuizId && quizzes.length > 0) {
      const quiz = quizzes.find(q => q.id.toString() === selectedQuizId);
      if (quiz && !assessmentName) {
        setAssessmentName(quiz.title);
      }
    }
  }, [selectedQuizId, quizzes]);

  const loadIntegration = async () => {
    try {
      const integrationData = await canvasService.getIntegration();
      setIntegration(integrationData);
      
      if (integrationData?.isConnected) {
        await loadCanvasCourses();
      } else {
        setShowConnectForm(true);
      }
    } catch (error) {
      console.error('Failed to load Canvas integration:', error);
    }
  };

  const loadCanvasCourses = async () => {
    setIsLoadingCourses(true);
    try {
      const courses = await canvasService.getCourses();
      setCanvasCourses(courses);
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

  const loadLocalCourses = async () => {
    try {
      const courses = await courseService.getCourses();
      setLocalCourses(courses);
    } catch (error) {
      console.error('Failed to load local courses:', error);
    }
  };

  const loadQuizzes = async (canvasCourseId: number) => {
    setIsLoadingQuizzes(true);
    try {
      const quizList = await canvasService.getQuizzes(canvasCourseId);
      setQuizzes(quizList);
    } catch (error: any) {
      toast({
        title: 'Failed to load quizzes',
        description: error.response?.data?.error || 'Failed to load quizzes from Canvas.',
        variant: 'destructive'
      });
      setQuizzes([]);
    } finally {
      setIsLoadingQuizzes(false);
    }
  };

  const loadTopics = async (courseId: number) => {
    setIsLoadingTopics(true);
    try {
      const topicList = await courseService.getCourseTopics(courseId);
      setTopics(topicList);
      if (topicList.length > 0 && !selectedTopicId) {
        setSelectedTopicId(topicList[0].id.toString());
      }
    } catch (error) {
      console.error('Failed to load topics:', error);
      setTopics([]);
    } finally {
      setIsLoadingTopics(false);
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
      await loadCanvasCourses();
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

  const handleImport = async () => {
    if (!selectedCanvasCourseId) {
      toast({
        title: 'Canvas course required',
        description: 'Please select a Canvas course.',
        variant: 'destructive'
      });
      return;
    }

    if (!selectedQuizId) {
      toast({
        title: 'Quiz required',
        description: 'Please select a quiz to import.',
        variant: 'destructive'
      });
      return;
    }

    if (!selectedLocalCourseId) {
      toast({
        title: 'Local course required',
        description: 'Please select a local course to import into.',
        variant: 'destructive'
      });
      return;
    }

    if (!selectedTopicId) {
      toast({
        title: 'Topic required',
        description: 'Please select a primary topic for the imported questions.',
        variant: 'destructive'
      });
      return;
    }

    if (!assessmentName.trim()) {
      toast({
        title: 'Assessment name required',
        description: 'Please enter a name for the assessment.',
        variant: 'destructive'
      });
      return;
    }

    setIsLoading(true);
    try {
      const result = await canvasService.importQuiz(
        parseInt(selectedCanvasCourseId),
        parseInt(selectedQuizId),
        parseInt(selectedLocalCourseId),
        {
          assessmentType,
          assessmentName: assessmentName.trim(),
          semester,
          primaryTopicId: parseInt(selectedTopicId)
        }
      );
      
      // Build success message
      let description = `Imported ${result.questionsImported} question${result.questionsImported !== 1 ? 's' : ''} from Canvas.`;
      if (result.questionsSkipped && result.questionsSkipped > 0) {
        description += ` ${result.questionsSkipped} question${result.questionsSkipped !== 1 ? 's were' : ' was'} skipped due to unsupported question types.`;
      }
      
      toast({
        title: 'Import successful!',
        description: description,
      });

      // If there are skipped questions, show details in console and optionally in a longer toast
      if (result.skippedQuestions && result.skippedQuestions.length > 0) {
        console.warn('Skipped questions during import:', result.skippedQuestions);
        // Show additional toast with details if there are many skipped questions
        if (result.skippedQuestions.length > 3) {
          toast({
            title: 'Some questions were skipped',
            description: `${result.skippedQuestions.length} questions with unsupported types were not imported. Check the browser console for details.`,
            variant: 'default',
          });
        }
      }

      if (onImportSuccess) {
        onImportSuccess({
          assessmentId: result.assessmentId,
          assessmentName: result.assessmentName
        });
      }

      // Reset form
      setSelectedCanvasCourseId('');
      setSelectedQuizId('');
      setSelectedLocalCourseId('');
      setSelectedTopicId('');
      setAssessmentName('');
      setQuizzes([]);
      
      onClose();
    } catch (error: any) {
      toast({
        title: 'Import failed',
        description: error.response?.data?.error || 'Failed to import quiz from Canvas.',
        variant: 'destructive'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const canImport = 
    integration?.isConnected &&
    selectedCanvasCourseId &&
    selectedQuizId &&
    selectedLocalCourseId &&
    selectedTopicId &&
    assessmentName.trim() &&
    !isLoading;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import from Canvas LMS</DialogTitle>
          <DialogDescription>
            Import a quiz from Canvas as a new assessment in Question Maker.
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
            {/* Canvas Course Selection */}
            <div className="space-y-2">
              <Label htmlFor="canvasCourse">Canvas Course</Label>
              {isLoadingCourses ? (
                <div className="text-sm text-muted-foreground">Loading courses...</div>
              ) : canvasCourses.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No courses found. Make sure you are enrolled as an instructor.
                </div>
              ) : (
                <Select value={selectedCanvasCourseId} onValueChange={setSelectedCanvasCourseId}>
                  <SelectTrigger id="canvasCourse">
                    <SelectValue placeholder="Select a Canvas course" />
                  </SelectTrigger>
                  <SelectContent>
                    {canvasCourses.map((course) => (
                      <SelectItem key={course.id} value={course.id.toString()}>
                        {course.course_code ? `${course.course_code} - ` : ''}{course.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Quiz Selection */}
            {selectedCanvasCourseId && (
              <div className="space-y-2">
                <Label htmlFor="quiz">Quiz</Label>
                {isLoadingQuizzes ? (
                  <div className="text-sm text-muted-foreground">Loading quizzes...</div>
                ) : quizzes.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    No quizzes found in this course.
                  </div>
                ) : (
                  <Select value={selectedQuizId} onValueChange={setSelectedQuizId}>
                    <SelectTrigger id="quiz">
                      <SelectValue placeholder="Select a quiz" />
                    </SelectTrigger>
                    <SelectContent>
                      {quizzes.map((quiz) => (
                        <SelectItem key={quiz.id} value={quiz.id.toString()}>
                          {quiz.title} {quiz.published ? '(Published)' : '(Unpublished)'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {/* Local Course Selection */}
            <div className="space-y-2">
              <Label htmlFor="localCourse">Local Course</Label>
              {localCourses.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No local courses found. Please create a course first.
                </div>
              ) : (
                <Select value={selectedLocalCourseId} onValueChange={setSelectedLocalCourseId}>
                  <SelectTrigger id="localCourse">
                    <SelectValue placeholder="Select a local course" />
                  </SelectTrigger>
                  <SelectContent>
                    {localCourses.map((course) => (
                      <SelectItem key={course.id} value={course.id.toString()}>
                        {course.code ? `${course.code} - ` : ''}{course.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Topic Selection */}
            {selectedLocalCourseId && (
              <div className="space-y-2">
                <Label htmlFor="topic">Primary Topic (Required)</Label>
                {isLoadingTopics ? (
                  <div className="text-sm text-muted-foreground">Loading topics...</div>
                ) : topics.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    No topics found. Please create a topic for this course first.
                  </div>
                ) : (
                  <Select value={selectedTopicId} onValueChange={setSelectedTopicId}>
                    <SelectTrigger id="topic">
                      <SelectValue placeholder="Select a topic" />
                    </SelectTrigger>
                    <SelectContent>
                      {topics.map((topic) => (
                        <SelectItem key={topic.id} value={topic.id.toString()}>
                          {topic.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <p className="text-xs text-muted-foreground">
                  All imported questions will be assigned to this topic.
                </p>
              </div>
            )}

            {/* Assessment Details */}
            <div className="space-y-2">
              <Label htmlFor="assessmentName">Assessment Name</Label>
              <Input
                id="assessmentName"
                placeholder="Enter assessment name"
                value={assessmentName}
                onChange={(e) => setAssessmentName(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="assessmentType">Assessment Type</Label>
                <Select value={assessmentType} onValueChange={setAssessmentType}>
                  <SelectTrigger id="assessmentType">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Quiz">Quiz</SelectItem>
                    <SelectItem value="Assignment">Assignment</SelectItem>
                    <SelectItem value="Exam">Exam</SelectItem>
                    <SelectItem value="Midterm">Midterm</SelectItem>
                    <SelectItem value="Final">Final</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="semester">Semester</Label>
                <Input
                  id="semester"
                  placeholder="Fall 2024"
                  value={semester}
                  onChange={(e) => setSemester(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowConnectForm(true);
                  setSelectedCanvasCourseId('');
                  setSelectedQuizId('');
                }}
              >
                Change Connection
              </Button>
              <Button
                onClick={handleImport}
                disabled={!canImport}
              >
                {isLoading ? 'Importing...' : 'Import from Canvas'}
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

export default CanvasImportDialog;
