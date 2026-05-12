/**
 * Developer-only API test page for exercising backend endpoints from the UI.
 * Includes forms to create/fetch courses, topics, questions, and assessments for debugging.
 */
import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Label } from '../components/ui/label';
import api from '../services/api';
import eduaiService from '../services/eduaiService';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/ui/use-toast';
import { EduAIStatusBadge } from '../components/eduai/EduAIStatusBadge';
import { useEduAIStatus } from '../hooks/useEduAIStatus';

interface ResultState {
  status: 'idle' | 'success' | 'error';
  payload?: any;
  message?: string;
}

const defaultResult: ResultState = { status: 'idle' };

export const ApiTestPage = () => {
  const { isAuthenticated, isLoading } = useAuth();
  const { toast } = useToast();
  const eduaiStatus = useEduAIStatus();

  const [courseForm, setCourseForm] = useState({
    name: '',
    code: ''
  });
  const [courseResult, setCourseResult] = useState<ResultState>(defaultResult);
  const [courseListResult, setCourseListResult] = useState<ResultState>(defaultResult);

  const [topicForm, setTopicForm] = useState({
    courseId: '',
    name: ''
  });
  const [topicResult, setTopicResult] = useState<ResultState>(defaultResult);

  const [questionForm, setQuestionForm] = useState({
    courseId: '',
    primaryTopicId: '',
    description: '',
    type: 'MCQ',
    questionOrder: ''
  });
  const [questionResult, setQuestionResult] = useState<ResultState>(defaultResult);

  const [assessmentForm, setAssessmentForm] = useState({
    name: '',
    type: 'Assignment',
    semester: ''
  });
  const [assessmentResult, setAssessmentResult] = useState<ResultState>(defaultResult);

  const [assessmentLinkForm, setAssessmentLinkForm] = useState({
    assessmentId: '',
    questionId: '',
    orderNumber: '1'
  });
  const [assessmentLinkResult, setAssessmentLinkResult] = useState<ResultState>(defaultResult);

  const [variantForm, setVariantForm] = useState({
    questionId: '',
    questionText: '',
    difficulty: 'medium',
    assessmentId: '',
    secondaryTopicsId: '',
    answer: '',
    referenceId: ''
  });
  const [variantResult, setVariantResult] = useState<ResultState>(defaultResult);

  // AI service form states
  const [eduaiChatForm, setEduaiChatForm] = useState({
    courseCode: 'COSC121',
    message: '',
    model: 'ollama:gpt-oss:120b'
  });
  const [eduaiChatResult, setEduaiChatResult] = useState<ResultState>(defaultResult);

  const [eduaiQuestionForm, setEduaiQuestionForm] = useState({
    courseCode: 'COSC121',
    prompt: '',
    model: 'ollama:gpt-oss:120b',
    numQuestions: '5',
    difficultyEasy: '1',
    difficultyMedium: '2',
    difficultyHard: '2'
  });
  const [eduaiQuestionResult, setEduaiQuestionResult] = useState<ResultState>(defaultResult);

  const [eduaiApiKeyResult, setEduaiApiKeyResult] = useState<ResultState>(defaultResult);
  const [isTestingApiKey, setIsTestingApiKey] = useState(false);
  const [eduaiTopicsForm, setEduaiTopicsForm] = useState({
    courseId: ''
  });
  const [eduaiTopicsResult, setEduaiTopicsResult] = useState<ResultState>(defaultResult);

  const handleApiCall = async (
    request: () => Promise<any>,
    onSuccess: (data: any) => void,
    onError: (message: string) => void
  ) => {
    try {
      const response = await request();
      onSuccess(response.data);
    } catch (error: any) {
      // Prioritize AI-provided error reason (from details/aiErrorReason fields) over generic error message
      const aiErrorReason = error.response?.data?.aiErrorReason;
      const details = error.response?.data?.details;
      const errorMessage = error.response?.data?.error;
      const message =
        aiErrorReason ||
        details ||
        errorMessage ||
        error.message ||
        'Request failed';
      onError(message);
      toast({
        variant: 'destructive',
        title: 'Request failed',
        description: message
      });
    }
  };

  const formatPayload = (payload: any) => JSON.stringify(payload, null, 2);

  const renderResult = (result: ResultState) => {
    if (result.status === 'idle') {
      return <p className="text-sm text-muted-foreground">Submit a form to see the API response.</p>;
    }

    if (result.status === 'error') {
      return (
        <p className="text-sm text-red-500 whitespace-pre-wrap">
          {result.message || 'Something went wrong.'}
        </p>
      );
    }

    return (
      <pre className="text-xs bg-muted rounded-md p-3 overflow-x-auto whitespace-pre-wrap">
        {formatPayload(result.payload)}
      </pre>
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">API Test Bench</h1>
            <p className="text-muted-foreground">
              Use the forms below to call the new backend routes directly.
            </p>
          </div>
          <EduAIStatusBadge
            status={eduaiStatus.status}
            message={eduaiStatus.message}
            onRefresh={eduaiStatus.refresh}
            questionGenerationPhase={eduaiStatus.questionGenerationPhase}
          />
        </header>

        <section className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Create Course</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="course-name">Name</Label>
                  <Input
                    id="course-name"
                    placeholder="e.g. Computer Science 101"
                    value={courseForm.name}
                    onChange={(event) => setCourseForm((prev) => ({ ...prev, name: event.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="course-code">Course Code (optional)</Label>
                  <Input
                    id="course-code"
                    placeholder="e.g. CS101"
                    value={courseForm.code}
                    onChange={(event) => setCourseForm((prev) => ({ ...prev, code: event.target.value }))}
                  />
                </div>
              </div>
              <Button
                onClick={() => {
                  if (!courseForm.name.trim()) {
                    toast({
                      variant: 'destructive',
                      title: 'Missing required fields',
                      description: 'Course name is required.'
                    });
                    return;
                  }

                  handleApiCall(
                    () =>
                      api.post('/api/course', {
                        name: courseForm.name,
                        courseCode: courseForm.code || undefined
                      }),
                    (data) => {
                      setCourseResult({ status: 'success', payload: data });
                      toast({ title: 'Course created' });
                    },
                    (message) => setCourseResult({ status: 'error', message })
                  );
                }}
              >
                Create Course
              </Button>
              <div>{renderResult(courseResult)}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>List Courses (includeStats)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                variant="outline"
                onClick={() =>
                  handleApiCall(
                    () => api.get('/api/course', { params: { includeStats: true } }),
                    (data) => setCourseListResult({ status: 'success', payload: data }),
                    (message) => setCourseListResult({ status: 'error', message })
                  )
                }
              >
                Fetch Courses
              </Button>
              <div>{renderResult(courseListResult)}</div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Create Topic</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="topic-course-id">Course ID</Label>
                <Input
                  id="topic-course-id"
                  type="number"
                  value={topicForm.courseId}
                  onChange={(event) => setTopicForm((prev) => ({ ...prev, courseId: event.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="topic-name">Topic Name</Label>
                <Input
                  id="topic-name"
                  value={topicForm.name}
                  onChange={(event) => setTopicForm((prev) => ({ ...prev, name: event.target.value }))}
                />
              </div>
              <Button
                onClick={() => {
                  if (!topicForm.courseId || !topicForm.name.trim()) {
                    toast({
                      variant: 'destructive',
                      title: 'Missing required fields',
                      description: 'Course ID and topic name are required.'
                    });
                    return;
                  }

                  handleApiCall(
                    () =>
                      api.post(`/api/course/${topicForm.courseId}/topics`, {
                        name: topicForm.name
                      }),
                    (data) => {
                      setTopicResult({ status: 'success', payload: data });
                      toast({ title: 'Topic created' });
                    },
                    (message) => setTopicResult({ status: 'error', message })
                  );
                }}
              >
                Create Topic
              </Button>
              <div>{renderResult(topicResult)}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Create Question</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="question-course-id">Course ID</Label>
                  <Input
                    id="question-course-id"
                    type="number"
                    value={questionForm.courseId}
                    onChange={(event) => setQuestionForm((prev) => ({ ...prev, courseId: event.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="question-topic-id">Primary Topic ID</Label>
                  <Input
                    id="question-topic-id"
                    type="number"
                    value={questionForm.primaryTopicId}
                    onChange={(event) => setQuestionForm((prev) => ({ ...prev, primaryTopicId: event.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="question-description">Description</Label>
                  <Textarea
                    id="question-description"
                    placeholder="Enter the question stem or prompt"
                    value={questionForm.description}
                    onChange={(event) => setQuestionForm((prev) => ({ ...prev, description: event.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Type</Label>
                  <Select
                    value={questionForm.type}
                    onValueChange={(value) => setQuestionForm((prev) => ({ ...prev, type: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MCQ">MCQ</SelectItem>
                      <SelectItem value="SA">Short Answer</SelectItem>
                      <SelectItem value="LA">Long Answer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="question-order">Question Order (JSON, optional)</Label>
                  <Input
                    id="question-order"
                    placeholder='e.g. {"1": 2}'
                    value={questionForm.questionOrder}
                    onChange={(event) => setQuestionForm((prev) => ({ ...prev, questionOrder: event.target.value }))}
                  />
                </div>
              </div>
              <Button
                onClick={() => {
                  if (!questionForm.courseId || !questionForm.primaryTopicId || !questionForm.description.trim()) {
                    toast({
                      variant: 'destructive',
                      title: 'Missing required fields',
                      description: 'Course ID, primary topic ID, and description are required.'
                    });
                    return;
                  }

                  let parsedOrder: unknown = undefined;
                  if (questionForm.questionOrder) {
                    try {
                      parsedOrder = JSON.parse(questionForm.questionOrder);
                    } catch (error) {
                      toast({
                        variant: 'destructive',
                        title: 'Invalid question order',
                        description: 'Question order must be valid JSON.'
                      });
                      return;
                    }
                  }

                  handleApiCall(
                    () =>
                      api.post('/api/questions', {
                        description: questionForm.description,
                        courseId: Number(questionForm.courseId),
                        primaryTopicId: Number(questionForm.primaryTopicId),
                        type: questionForm.type,
                        questionOrder: parsedOrder
                      }),
                    (data) => {
                      setQuestionResult({ status: 'success', payload: data });
                      toast({ title: 'Question created' });
                    },
                    (message) => setQuestionResult({ status: 'error', message })
                  );
                }}
              >
                Create Question
              </Button>
              <div>{renderResult(questionResult)}</div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Create Assessment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="assessment-name">Name</Label>
                <Input
                  id="assessment-name"
                  value={assessmentForm.name}
                  onChange={(event) => setAssessmentForm((prev) => ({ ...prev, name: event.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Type</Label>
                <Select
                  value={assessmentForm.type}
                  onValueChange={(value) => setAssessmentForm((prev) => ({ ...prev, type: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Assignment">Assignment</SelectItem>
                    <SelectItem value="Lab">Lab</SelectItem>
                    <SelectItem value="Quiz">Quiz</SelectItem>
                    <SelectItem value="Mid">Mid</SelectItem>
                    <SelectItem value="Final">Final</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="assessment-semester">Semester</Label>
                <Input
                  id="assessment-semester"
                  value={assessmentForm.semester}
                  onChange={(event) => setAssessmentForm((prev) => ({ ...prev, semester: event.target.value }))}
                />
              </div>
              <Button
                onClick={() => {
                  if (!assessmentForm.name.trim() || !assessmentForm.semester.trim()) {
                    toast({
                      variant: 'destructive',
                      title: 'Missing required fields',
                      description: 'Name and semester are required.'
                    });
                    return;
                  }

                  handleApiCall(
                    () =>
                      api.post('/api/assessments', {
                        name: assessmentForm.name,
                        type: assessmentForm.type,
                        semester: assessmentForm.semester
                      }),
                    (data) => {
                      setAssessmentResult({ status: 'success', payload: data });
                      toast({ title: 'Assessment created' });
                    },
                    (message) => setAssessmentResult({ status: 'error', message })
                  );
                }}
              >
                Create Assessment
              </Button>
              <div>{renderResult(assessmentResult)}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Link Question to Assessment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="link-assessment-id">Assessment ID</Label>
                <Input
                  id="link-assessment-id"
                  type="number"
                  value={assessmentLinkForm.assessmentId}
                  onChange={(event) => setAssessmentLinkForm((prev) => ({ ...prev, assessmentId: event.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="link-question-id">Question ID</Label>
                <Input
                  id="link-question-id"
                  type="number"
                  value={assessmentLinkForm.questionId}
                  onChange={(event) => setAssessmentLinkForm((prev) => ({ ...prev, questionId: event.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="link-order-number">Order Number</Label>
                <Input
                  id="link-order-number"
                  type="number"
                  value={assessmentLinkForm.orderNumber}
                  onChange={(event) => setAssessmentLinkForm((prev) => ({ ...prev, orderNumber: event.target.value }))}
                />
              </div>
              <Button
                onClick={() => {
                  if (!assessmentLinkForm.assessmentId || !assessmentLinkForm.questionId) {
                    toast({
                      variant: 'destructive',
                      title: 'Missing required fields',
                      description: 'Assessment ID and question ID are required.'
                    });
                    return;
                  }

                  handleApiCall(
                    () =>
                      api.post(`/api/assessments/${assessmentLinkForm.assessmentId}/questions`, {
                        questionId: assessmentLinkForm.questionId ? Number(assessmentLinkForm.questionId) : undefined,
                        orderNumber: assessmentLinkForm.orderNumber ? Number(assessmentLinkForm.orderNumber) : 1
                      }),
                    (data) => {
                      setAssessmentLinkResult({ status: 'success', payload: data });
                      toast({ title: 'Question linked' });
                    },
                    (message) => setAssessmentLinkResult({ status: 'error', message })
                  );
                }}
              >
                Add Question to Assessment
              </Button>
              <div>{renderResult(assessmentLinkResult)}</div>
            </CardContent>
          </Card>
        </section>

        <section>
          <Card>
            <CardHeader>
              <CardTitle>Create Question Variant</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="variant-question-id">Question ID</Label>
                  <Input
                    id="variant-question-id"
                    type="number"
                    value={variantForm.questionId}
                    onChange={(event) => setVariantForm((prev) => ({ ...prev, questionId: event.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Difficulty</Label>
                  <Select
                    value={variantForm.difficulty}
                    onValueChange={(value) => setVariantForm((prev) => ({ ...prev, difficulty: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="easy">Easy</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="hard">Hard</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="variant-assessment-id">Assessment ID (optional)</Label>
                  <Input
                    id="variant-assessment-id"
                    type="number"
                    value={variantForm.assessmentId}
                    onChange={(event) => setVariantForm((prev) => ({ ...prev, assessmentId: event.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="variant-secondary-topic">Secondary Topic IDs (comma separated, optional)</Label>
                  <Input
                    id="variant-secondary-topic"
                    placeholder="e.g. 1,2,3"
                    value={variantForm.secondaryTopicsId}
                    onChange={(event) => setVariantForm((prev) => ({ ...prev, secondaryTopicsId: event.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="variant-reference-id">Reference Variant ID (optional)</Label>
                  <Input
                    id="variant-reference-id"
                    type="number"
                    value={variantForm.referenceId}
                    onChange={(event) => setVariantForm((prev) => ({ ...prev, referenceId: event.target.value }))}
                  />
                </div>
                <div className="md:col-span-2 space-y-1">
                  <Label htmlFor="variant-question-text">Question Text</Label>
                  <Textarea
                    id="variant-question-text"
                    value={variantForm.questionText}
                    onChange={(event) => setVariantForm((prev) => ({ ...prev, questionText: event.target.value }))}
                  />
                </div>
                <div className="md:col-span-2 space-y-1">
                  <Label htmlFor="variant-answer">Answer (optional)</Label>
                  <Textarea
                    id="variant-answer"
                    value={variantForm.answer}
                    onChange={(event) => setVariantForm((prev) => ({ ...prev, answer: event.target.value }))}
                  />
                </div>
              </div>
              <Button
                onClick={() => {
                  if (!variantForm.questionId || !variantForm.questionText.trim()) {
                    toast({
                      variant: 'destructive',
                      title: 'Missing required fields',
                      description: 'Question ID and question text are required.'
                    });
                    return;
                  }

                  handleApiCall(
                    () =>
                      api.post(`/api/questions/${variantForm.questionId}/variants`, {
                        questionText: variantForm.questionText,
                        difficulty: variantForm.difficulty,
                        assessmentId: variantForm.assessmentId ? Number(variantForm.assessmentId) : undefined,
                        secondaryTopicsId: variantForm.secondaryTopicsId
                          ? variantForm.secondaryTopicsId
                              .split(',')
                              .map((item) => Number(item.trim()))
                              .filter((item) => Number.isInteger(item))
                          : undefined,
                        referenceId: variantForm.referenceId ? Number(variantForm.referenceId) : undefined,
                        answer: variantForm.answer || undefined
                      }),
                    (data) => {
                      setVariantResult({ status: 'success', payload: data });
                      toast({ title: 'Variant created' });
                    },
                    (message) => setVariantResult({ status: 'error', message })
                  );
                }}
              >
                Create Variant
              </Button>
              <div>{renderResult(variantResult)}</div>
            </CardContent>
          </Card>
        </section>

        {/* AI service integration tests */}
        <section>
          <Card>
            <CardHeader>
              <CardTitle>AI Service Integration Tests</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* AI service API key test */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">API Key Test</h3>
                <Button
                  variant="outline"
                  disabled={isTestingApiKey}
                  onClick={async () => {
                    setIsTestingApiKey(true);
                    try {
                      await handleApiCall(
                        () => eduaiService.testApiKey(),
                        (data) => setEduaiApiKeyResult({ status: 'success', payload: data }),
                        (message) => setEduaiApiKeyResult({ status: 'error', message })
                      );
                    } finally {
                      setIsTestingApiKey(false);
                    }
                  }}
                >
                  {isTestingApiKey ? 'Testing...' : 'Test API Key'}
                </Button>
                <div>{renderResult(eduaiApiKeyResult)}</div>
              </div>

            </CardContent>
          </Card>
        </section>

        <section>
          <Card>
            <CardHeader>
              <CardTitle>AI Service Course Topics</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Hit the live AI service endpoint <code>/api/courses/:courseId/topics</code> to preview the topic list for a course.
              </p>
              <div className="space-y-1">
                <Label htmlFor="eduai-topics-course-id">AI Service Course ID</Label>
                <Input
                  id="eduai-topics-course-id"
                  placeholder="e.g. COSC211"
                  value={eduaiTopicsForm.courseId}
                  onChange={(event) =>
                    setEduaiTopicsForm((prev) => ({ ...prev, courseId: event.target.value }))
                  }
                />
              </div>
              <Button
                onClick={() => {
                  const trimmedId = eduaiTopicsForm.courseId.trim();
                  if (!trimmedId) {
                    toast({
                      variant: 'destructive',
                      title: 'Missing course ID',
                      description: 'Enter the AI service course identifier you want to inspect.'
                    });
                    return;
                  }

                  handleApiCall(
                    () => eduaiService.fetchCourseTopics(trimmedId),
                    (data) => {
                      setEduaiTopicsResult({ status: 'success', payload: data });
                      toast({ title: 'Fetched course topics' });
                    },
                    (message) => setEduaiTopicsResult({ status: 'error', message })
                  );
                }}
              >
                Fetch AI Service Topics
              </Button>
              <div>{renderResult(eduaiTopicsResult)}</div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-6 md:grid-cols-2">
          {/* AI service chat test */}
          <Card>
            <CardHeader>
              <CardTitle>AI Service Chat</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="eduai-course-code">Course Code</Label>
                <Input
                  id="eduai-course-code"
                  placeholder="COSC121 or COSC211"
                  value={eduaiChatForm.courseCode}
                  onChange={(event) => setEduaiChatForm((prev) => ({ ...prev, courseCode: event.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Model</Label>
                <Select
                  value={eduaiChatForm.model}
                  onValueChange={(value) => setEduaiChatForm((prev) => ({ ...prev, model: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ollama:gpt-oss:120b">Ollama GPT OSS 120B (No API key needed)</SelectItem>
                    <SelectItem value="google:gemini-2.5-flash">Google Gemini 2.5 Flash</SelectItem>
                    <SelectItem value="openai:gpt-4">OpenAI GPT-4</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="eduai-message">Message</Label>
                <Textarea
                  id="eduai-message"
                  placeholder="Ask a question about the course material..."
                  value={eduaiChatForm.message}
                  onChange={(event) => setEduaiChatForm((prev) => ({ ...prev, message: event.target.value }))}
                />
              </div>
              <Button
                onClick={() => {
                  if (!eduaiChatForm.courseCode.trim() || !eduaiChatForm.message.trim()) {
                    toast({
                      variant: 'destructive',
                      title: 'Missing required fields',
                      description: 'Course code and message are required.'
                    });
                    return;
                  }

                  handleApiCall(
                    () => eduaiService.chat({
                      messages: [{ role: 'user', content: eduaiChatForm.message }],
                      courseCode: eduaiChatForm.courseCode,
                      model: eduaiChatForm.model,
                      apiKeys: eduaiChatForm.model.includes('ollama') ? {
                        ollama: {
                          isEnabled: true
                        }
                      } : {}
                    }),
                    (data) => {
                      setEduaiChatResult({ status: 'success', payload: data });
                      toast({ title: 'Chat request sent' });
                    },
                    (message) => setEduaiChatResult({ status: 'error', message })
                  );
                }}
              >
                Send Chat Message
              </Button>
              <div>{renderResult(eduaiChatResult)}</div>
            </CardContent>
          </Card>

          {/* AI service question generation test */}
          <Card>
            <CardHeader>
              <CardTitle>AI Service Question Generation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="eduai-q-course-code">Course Code</Label>
                <Input
                  id="eduai-q-course-code"
                  placeholder="COSC121 or COSC211"
                  value={eduaiQuestionForm.courseCode}
                  onChange={(event) => setEduaiQuestionForm((prev) => ({ ...prev, courseCode: event.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Model</Label>
                <Select
                  value={eduaiQuestionForm.model}
                  onValueChange={(value) => setEduaiQuestionForm((prev) => ({ ...prev, model: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ollama:gpt-oss:120b">Ollama GPT OSS 120B (No API key needed)</SelectItem>
                    <SelectItem value="google:gemini-2.5-flash">Google Gemini 2.5 Flash</SelectItem>
                    <SelectItem value="openai:gpt-4">OpenAI GPT-4</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="eduai-prompt">Topic/Prompt</Label>
                <Textarea
                  id="eduai-prompt"
                  placeholder="e.g. Data structures and algorithms, Machine learning basics..."
                  value={eduaiQuestionForm.prompt}
                  onChange={(event) => setEduaiQuestionForm((prev) => ({ ...prev, prompt: event.target.value }))}
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="eduai-num-questions">Number of Questions</Label>
                  <Input
                    id="eduai-num-questions"
                    type="number"
                    min="1"
                    max="20"
                    value={eduaiQuestionForm.numQuestions}
                    onChange={(event) => setEduaiQuestionForm((prev) => ({ ...prev, numQuestions: event.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="eduai-easy">Easy</Label>
                  <Input
                    id="eduai-easy"
                    type="number"
                    min="0"
                    value={eduaiQuestionForm.difficultyEasy}
                    onChange={(event) => setEduaiQuestionForm((prev) => ({ ...prev, difficultyEasy: event.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="eduai-medium">Medium</Label>
                  <Input
                    id="eduai-medium"
                    type="number"
                    min="0"
                    value={eduaiQuestionForm.difficultyMedium}
                    onChange={(event) => setEduaiQuestionForm((prev) => ({ ...prev, difficultyMedium: event.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="eduai-hard">Hard</Label>
                <Input
                  id="eduai-hard"
                  type="number"
                  min="0"
                  value={eduaiQuestionForm.difficultyHard}
                  onChange={(event) => setEduaiQuestionForm((prev) => ({ ...prev, difficultyHard: event.target.value }))}
                />
              </div>
              <Button
                onClick={() => {
                  if (!eduaiQuestionForm.courseCode.trim() || !eduaiQuestionForm.prompt.trim()) {
                    toast({
                      variant: 'destructive',
                      title: 'Missing required fields',
                      description: 'Course code and prompt are required.'
                    });
                    return;
                  }

                  const numQuestions = parseInt(eduaiQuestionForm.numQuestions);
                  const easy = parseInt(eduaiQuestionForm.difficultyEasy);
                  const medium = parseInt(eduaiQuestionForm.difficultyMedium);
                  const hard = parseInt(eduaiQuestionForm.difficultyHard);

                  if (easy + medium + hard !== numQuestions) {
                    toast({
                      variant: 'destructive',
                      title: 'Invalid difficulty distribution',
                      description: 'Sum of difficulty levels must equal number of questions.'
                    });
                    return;
                  }

                  handleApiCall(
                    () => eduaiService.generateQuestions({
                      prompt: eduaiQuestionForm.prompt,
                      courseCode: eduaiQuestionForm.courseCode,
                      model: eduaiQuestionForm.model,
                      apiKeys: eduaiQuestionForm.model.includes('ollama') ? {
                        ollama: {
                          isEnabled: true
                        }
                      } : {},
                      numQuestions,
                      difficultyDistribution: { easy, medium, hard }
                    }),
                    (data) => {
                      setEduaiQuestionResult({ status: 'success', payload: data });
                      toast({ title: 'Questions generated' });
                    },
                    (message) => setEduaiQuestionResult({ status: 'error', message })
                  );
                }}
              >
                Generate Questions
              </Button>
              <div>{renderResult(eduaiQuestionResult)}</div>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
};

export default ApiTestPage;
