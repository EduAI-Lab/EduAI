/**
 * Canvas integration service that manages token storage, course mappings, exports, and imports.
 * Supports both real Canvas API calls and a mock test mode for development/demo flows.
 */
import axios from 'axios';
import { CanvasIntegration, CanvasCourseMapping, Question_Metadata, Variants, AssessmentSections, SectionVariants, Course } from '../schema/index.js';
import { getAssessmentById, createAssessment } from './assessmentService.js';
import { createQuestion } from './questionService.js';
import { createAssessmentSection } from './assessmentSectionService.js';

/**
 * Canvas LMS API Service
 * Supports both real Canvas API integration and test mode for development
 */

// Mock data for test mode
const MOCK_CANVAS_COURSES = [
  { id: 1, name: 'Introduction to Computer Science', course_code: 'COSC 101' },
  { id: 2, name: 'Data Structures and Algorithms', course_code: 'COSC 201' },
  { id: 3, name: 'Machine Architecture', course_code: 'COSC 211' },
  { id: 4, name: 'Computer Programming II', course_code: 'COSC 121' }
];

/** Retrieves the Canvas integration settings (if any) for the specified user. */
export const getCanvasIntegration = async (userId) => {
  try {
    let integration = await CanvasIntegration.findOne({
      where: { userId }
    });

    return integration;
  } catch (error) {
    throw new Error(`Failed to get Canvas integration: ${error.message}`);
  }
};

/** Creates or updates the Canvas integration credentials/test-mode flag for a user. */
export const saveCanvasIntegration = async (userId, { canvasUrl, apiKey, isTestMode = false }) => {
  try {
    const [integration, created] = await CanvasIntegration.findOrCreate({
      where: { userId },
      defaults: {
        userId,
        canvasUrl,
        apiKey, // In production, encrypt this
        isTestMode
      }
    });

    if (!created) {
      await integration.update({
        canvasUrl,
        apiKey,
        isTestMode
      });
    }

    return integration;
  } catch (error) {
    throw new Error(`Failed to save Canvas integration: ${error.message}`);
  }
};

/** Executes a Canvas API request, returning mock data when test mode is enabled. */
const makeCanvasRequest = async (integration, method, endpoint, data = null) => {
  if (integration.isTestMode) {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Return mock responses based on endpoint
    if (endpoint.includes('/courses') && method === 'GET' && !endpoint.includes('/quizzes')) {
      return { data: MOCK_CANVAS_COURSES };
    }
    if (endpoint.includes('/quizzes') && method === 'POST') {
      return { data: { id: Math.floor(Math.random() * 1000), title: data?.quiz?.title || 'Test Quiz' } };
    }
    if (endpoint.includes('/quizzes') && method === 'GET' && !endpoint.includes('/questions')) {
      // Mock quizzes list
      return { data: [
        { id: 1, title: 'Test Quiz 1', quiz_type: 'assignment', published: false },
        { id: 2, title: 'Test Quiz 2', quiz_type: 'assignment', published: true }
      ] };
    }
    if (endpoint.includes('/questions') && method === 'POST') {
      return { data: { id: Math.floor(Math.random() * 1000) } };
    }
    if (endpoint.includes('/questions') && method === 'GET') {
      const singleQuestionMatch = endpoint.match(/\/questions\/(\d+)$/);
      const singleQuestion = {
        id: 1,
        question_name: '1. Test Question',
        question_text: 'What is 2+2?\nA) 3\nB) 4\nC) 5\nD) 6',
        question_type: 'multiple_choice_question',
        position: 1,
        answers: [
          { id: 1, answer_text: '3', answer_weight: 0 },
          { id: 2, answer_text: '4', answer_weight: 100 },
          { id: 3, answer_text: '5', answer_weight: 0 },
          { id: 4, answer_text: '6', answer_weight: 0 }
        ]
      };
      // Single question by ID returns one object; list returns array
      if (singleQuestionMatch) {
        return { data: { ...singleQuestion, id: parseInt(singleQuestionMatch[1], 10) } };
      }
      return { data: [singleQuestion] };
    }
    if (endpoint.includes('/quizzes') && method === 'GET' && endpoint.match(/\/quizzes\/\d+$/)) {
      // Single quiz details
      const quizId = endpoint.match(/\/quizzes\/(\d+)$/)?.[1];
      return { data: { id: parseInt(quizId), title: 'Test Quiz', quiz_type: 'assignment', published: false } };
    }
    return { data: { success: true } };
  }

  // Real Canvas API request
  const url = `${integration.canvasUrl}/api/v1${endpoint}`;
  const config = {
    method,
    url,
    headers: {
      'Authorization': `Bearer ${integration.apiKey}`,
      'Content-Type': 'application/json'
    }
  };

  if (data) {
    config.data = data;
  }

  try {
    const response = await axios(config);
    return response;
  } catch (error) {
    if (error.response) {
      throw new Error(`Canvas API error: ${error.response.status} - ${error.response.data?.message || error.response.statusText}`);
    }
    throw new Error(`Canvas API request failed: ${error.message}`);
  }
};

/** Lists Canvas courses available to the instructor, or mock courses in test mode. */
export const getCanvasCourses = async (userId) => {
  try {
    const integration = await getCanvasIntegration(userId);
    
    if (!integration) {
      throw new Error('Canvas integration not configured. Please connect your Canvas account first.');
    }

    if (integration.isTestMode) {
      // Return mock courses in test mode
      return MOCK_CANVAS_COURSES;
    }
    
    const response = await makeCanvasRequest(integration, 'GET', '/courses?enrollment_type=teacher&enrollment_role=TeacherEnrollment');
    
    return response.data;
  } catch (error) {
    throw new Error(`Failed to get Canvas courses: ${error.message}`);
  }
};

/** Exports an assessment’s sections/variants to Canvas as a quiz and stores the mapping. */
export const exportAssessmentToCanvas = async (userId, assessmentId, canvasCourseId) => {
  try {
    const integration = await getCanvasIntegration(userId);
    
    if (!integration) {
      throw new Error('Canvas integration not configured. Please connect your Canvas account first.');
    }

    // Get the assessment with all its questions
    const assessment = await getAssessmentById(assessmentId, userId);
    
    if (!assessment) {
      throw new Error('Assessment not found');
    }

    // Get all questions from sections
    const questions = [];
    if (assessment.sections && assessment.sections.length > 0) {
      for (const section of assessment.sections) {
        if (section.sectionVariants && section.sectionVariants.length > 0) {
          for (const sectionVariant of section.sectionVariants) {
            const variant = sectionVariant.variant;
            if (variant) {
              questions.push({
                variant,
                sectionName: section.name,
                displayOrder: sectionVariant.displayOrder
              });
            }
          }
        }
      }
    }

    if (questions.length === 0) {
      throw new Error('Assessment has no questions to export');
    }

    // Create quiz in Canvas
    const quizData = {
      quiz: {
        title: assessment.name,
        description: assessment.description || `Exported from Question Maker - ${assessment.type}`,
        quiz_type: 'assignment',
        published: false, // Don't publish automatically
        show_correct_answers: true,
        allowed_attempts: 1
      }
    };

    const quizResponse = await makeCanvasRequest(
      integration,
      'POST',
      `/courses/${canvasCourseId}/quizzes`,
      quizData
    );

    const quizId = quizResponse.data.id;

    // Create questions in Canvas
    const createdQuestions = [];
    for (let i = 0; i < questions.length; i++) {
      const { variant, sectionName } = questions[i];
      const questionMetadata = variant.questionMetadata;
      
      if (!questionMetadata) continue;

      const canvasQuestion = convertVariantToCanvasQuestion(variant, questionMetadata, i + 1, sectionName);
      
      const questionResponse = await makeCanvasRequest(
        integration,
        'POST',
        `/courses/${canvasCourseId}/quizzes/${quizId}/questions`,
        { question: canvasQuestion }
      );

      createdQuestions.push(questionResponse.data);
    }

    // Save course mapping if it doesn't exist
    const courseMapping = await CanvasCourseMapping.findOne({
      where: {
        userId,
        localCourseId: assessment.courseId
      }
    });

    if (!courseMapping) {
      await CanvasCourseMapping.create({
        userId,
        localCourseId: assessment.courseId,
        canvasCourseId,
        canvasCourseName: integration.isTestMode ? 'Test Course' : undefined
      });
    }

    return {
      quizId,
      quizTitle: quizResponse.data.title,
      questionsCreated: createdQuestions.length,
      canvasUrl: integration.isTestMode 
        ? `[TEST MODE] Quiz would be created at: ${integration.canvasUrl}/courses/${canvasCourseId}/quizzes/${quizId}`
        : `${integration.canvasUrl}/courses/${canvasCourseId}/quizzes/${quizId}`
    };
  } catch (error) {
    throw new Error(`Failed to export assessment to Canvas: ${error.message}`);
  }
};

/** Converts a local variant into a Canvas quiz question payload (MCQ/SA/LA supported). */
const convertVariantToCanvasQuestion = (variant, questionMetadata, position, sectionName) => {
  const questionText = variant.questionText || '';
  const answerText = variant.answer || '';
  const isMCQ = questionMetadata.type === 'MCQ';
  const isLongAnswer = questionMetadata.type === 'LA';
  
  const baseQuestion = {
    question_name: `${position}. ${questionMetadata.description || 'Question'}`,
    question_text: questionText,
    points_possible: 1,
    position: position
  };

  if (isMCQ) {
    // Use choices array if available, otherwise fallback to parsing from questionText
    let options = [];
    
    if (variant.choices && Array.isArray(variant.choices) && variant.choices.length > 0) {
      // Use choices array directly
      const correctLetter = answerText ? answerText.trim().toUpperCase().charAt(0) : null;
      options = variant.choices.map((choice) => ({
        text: choice.text,
        letter: choice.letter,
        isCorrect: choice.letter === correctLetter
      }));
    } else {
      // Fallback to parsing from questionText for legacy data
      options = parseMCQOptions(questionText, answerText);
    }
    
    return {
      ...baseQuestion,
      question_type: 'multiple_choice_question',
      answers: options.map((option) => ({
        answer_text: option.text,
        answer_weight: option.isCorrect ? 100 : 0,
        answer_comment: option.isCorrect ? 'Correct!' : ''
      }))
    };
  } else {
    // Long/short answer question
    return {
      ...baseQuestion,
      question_type: isLongAnswer ? 'essay_question' : 'short_answer_question',
      answers: [
        {
          answer_text: answerText || 'Sample answer',
          answer_weight: 100
        }
      ]
    };
  }
};

/** Parses MCQ options from the variant text and flags the correct answer letter if present. */
const parseMCQOptions = (questionText, answerText) => {
  const lines = questionText.split('\n');
  const options = [];
  
  // Extract the correct answer letter from answer text
  let correctAnswerLetter = null;
  if (answerText) {
    const answerMatch = answerText.match(/^([A-D])\)?/);
    if (answerMatch) {
      correctAnswerLetter = answerMatch[1];
    }
  }
  
  // Parse options from question text
  for (const line of lines) {
    const match = line.match(/^([A-D])\)\s*(.+)$/);
    if (match) {
      const letter = match[1];
      const text = match[2].trim();
      options.push({
        text,
        letter,
        isCorrect: letter === correctAnswerLetter
      });
    }
  }

  // If no options found, create default options
  if (options.length === 0) {
    return [
      { text: 'Option A', isCorrect: correctAnswerLetter === 'A' },
      { text: 'Option B', isCorrect: correctAnswerLetter === 'B' || !correctAnswerLetter },
      { text: 'Option C', isCorrect: correctAnswerLetter === 'C' },
      { text: 'Option D', isCorrect: correctAnswerLetter === 'D' }
    ];
  }

  // Sort options by letter (A, B, C, D)
  options.sort((a, b) => a.letter.localeCompare(b.letter));

  return options;
};

/** Returns the stored Canvas course mapping for a given user/local-course pair. */
export const getCanvasCourseMapping = async (userId, localCourseId) => {
  try {
    const mapping = await CanvasCourseMapping.findOne({
      where: {
        userId,
        localCourseId
      }
    });

    return mapping;
  } catch (error) {
    throw new Error(`Failed to get Canvas course mapping: ${error.message}`);
  }
};

/** Lists quizzes from a Canvas course, filtering to assignment-style quizzes. */
export const getCanvasQuizzes = async (userId, canvasCourseId) => {
  try {
    const integration = await getCanvasIntegration(userId);
    
    if (!integration) {
      throw new Error('Canvas integration not configured. Please connect your Canvas account first.');
    }

    const response = await makeCanvasRequest(
      integration,
      'GET',
      `/courses/${canvasCourseId}/quizzes`
    );

    // Filter to only return assignment-type quizzes (what we export)
    const quizzes = Array.isArray(response.data) ? response.data : [response.data];
    return quizzes.filter(quiz => quiz.quiz_type === 'assignment' || quiz.quiz_type === 'graded_survey');
  } catch (error) {
    throw new Error(`Failed to get Canvas quizzes: ${error.message}`);
  }
};

// Debug prefix for Canvas import troubleshooting (grep for this to see all import logs)
const DEBUG_PREFIX = '[Canvas Import]';

/** Fetches the question list for a Canvas quiz. Note: list endpoint often returns answers as null; use getCanvasQuizQuestionById for full details. */
export const getCanvasQuizQuestions = async (userId, canvasCourseId, quizId) => {
  try {
    const integration = await getCanvasIntegration(userId);

    if (!integration) {
      throw new Error('Canvas integration not configured. Please connect your Canvas account first.');
    }

    const response = await makeCanvasRequest(
      integration,
      'GET',
      `/courses/${canvasCourseId}/quizzes/${quizId}/questions`
    );

    const list = Array.isArray(response.data) ? response.data : [response.data];
    console.log(`${DEBUG_PREFIX} getCanvasQuizQuestions: got ${list.length} question(s). isTestMode=${!!integration?.isTestMode}`);
    if (list.length > 0) {
      const first = list[0];
      const firstKeys = first && typeof first === 'object' ? Object.keys(first) : [];
      const firstAnswers = first?.answers;
      console.log(`${DEBUG_PREFIX} list[0] keys: ${firstKeys.join(', ')}; answers type=${typeof firstAnswers}, isArray=${Array.isArray(firstAnswers)}, length=${firstAnswers?.length ?? 'N/A'}`);
      if (first?.question_text) {
        console.log(`${DEBUG_PREFIX} list[0] question_text (first 120 chars): ${String(first.question_text).slice(0, 120)}...`);
      }
    }
    return list;
  } catch (error) {
    throw new Error(`Failed to get Canvas quiz questions: ${error.message}`);
  }
};

/** Fetches a single Canvas quiz question by ID, including the answers array (required for MCQ choices and correct answer). */
export const getCanvasQuizQuestionById = async (userId, canvasCourseId, quizId, questionId) => {
  try {
    const integration = await getCanvasIntegration(userId);

    if (!integration) {
      throw new Error('Canvas integration not configured. Please connect your Canvas account first.');
    }

    const response = await makeCanvasRequest(
      integration,
      'GET',
      `/courses/${canvasCourseId}/quizzes/${quizId}/questions/${questionId}`
    );

    const data = response.data;
    const topLevelKeys = data && typeof data === 'object' ? Object.keys(data) : [];
    console.log(`${DEBUG_PREFIX} getCanvasQuizQuestionById(${questionId}) response keys: ${topLevelKeys.join(', ')}; has data.question=${!!(data?.question)}`);

    // Some Canvas API responses wrap the question in a 'question' key
    const question = (data && typeof data === 'object' && data.question != null) ? data.question : data;
    const questionKeys = question && typeof question === 'object' ? Object.keys(question) : [];
    const answers = question?.answers;
    console.log(`${DEBUG_PREFIX} getCanvasQuizQuestionById(${questionId}) question keys: ${questionKeys.join(', ')}; answers type=${typeof answers}, isArray=${Array.isArray(answers)}, length=${answers?.length ?? 'N/A'}`);
    if (answers?.length > 0) {
      console.log(`${DEBUG_PREFIX} getCanvasQuizQuestionById(${questionId}) first answer: ${JSON.stringify(answers[0])}`);
    }
    if (question?.question_text) {
      console.log(`${DEBUG_PREFIX} getCanvasQuizQuestionById(${questionId}) question_text (first 150 chars): ${String(question.question_text).slice(0, 150)}...`);
    }
    return question;
  } catch (error) {
    throw new Error(`Failed to get Canvas quiz question: ${error.message}`);
  }
};

/** Removes Canvas HTML markup from question text while preserving logical line breaks. */
const stripHtmlTags = (html) => {
  if (!html || typeof html !== 'string') return '';
  
  let text = html;
  
  // Replace block-level elements with line breaks
  text = text.replace(/<\/p>/gi, '\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<\/li>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/h[1-6]>/gi, '\n');
  
  // Remove all remaining HTML tags
  text = text.replace(/<[^>]*>/g, '');
  
  // Decode HTML entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&[#\w]+;/g, '');
  
  // Normalize whitespace: collapse multiple spaces, preserve single newlines
  text = text
    .replace(/[ \t]+/g, ' ') // Collapse spaces and tabs
    .replace(/\n{3,}/g, '\n\n') // Max 2 consecutive newlines
    .replace(/[ \t]*\n[ \t]*/g, '\n') // Remove spaces around newlines
    .trim();
  
  return text;
};

/** Normalize Canvas question_type for comparison (align with export types). */
const normalizeCanvasQuestionType = (questionType) => {
  if (questionType == null) return '';
  return String(questionType).toLowerCase().trim();
};

/** Canvas API uses either answer_text/answer_weight (docs) or text/weight (submission/list API). Normalize to one shape. */
const getCanvasAnswerText = (ans) => ans?.answer_text ?? ans?.text ?? '';
const getCanvasAnswerWeight = (ans) => {
  const w = ans?.answer_weight ?? ans?.weight;
  return w != null ? Number(w) : null;
};
const isCanvasAnswerCorrect = (ans) => {
  const w = getCanvasAnswerWeight(ans);
  return w === 100 || (w != null && w > 0);
};

/**
 * Parses MCQ choices from question text when Canvas returns answers as null.
 * Handles formats like "Question text\nA) Option A\nB) Option B\nC) Option C\nD) Option D".
 * Returns { questionText: string, choices: Array<{letter: string, text: string}> }.
 */
const parseChoicesFromQuestionText = (questionText) => {
  if (!questionText || typeof questionText !== 'string') {
    return { questionText: questionText || '', choices: [] };
  }
  const lines = questionText.split('\n');
  const choices = [];
  const questionLines = [];
  const choicePattern = /^([A-Za-z])\)\s*(.+)$/;
  let foundChoices = false;
  for (const line of lines) {
    const trimmedLine = line.trim();
    const match = trimmedLine.match(choicePattern);
    if (match) {
      foundChoices = true;
      choices.push({ letter: match[1].toUpperCase(), text: match[2].trim() });
    } else if (trimmedLine && !foundChoices) {
      questionLines.push(line);
    }
  }
  const cleanQuestionText = questionLines.join('\n').trim();
  return {
    questionText: cleanQuestionText || questionText,
    choices
  };
};

/** Converts a Canvas question into local variant metadata, throwing for unsupported types. */
const convertCanvasQuestionToVariant = (canvasQuestion) => {
  const questionTypeRaw = canvasQuestion.question_type;
  const questionType = normalizeCanvasQuestionType(questionTypeRaw);
  const questionTextRaw = canvasQuestion.question_text || '';
  const questionName = canvasQuestion.question_name || '';

  const answersInput = canvasQuestion.answers;
  console.log(`${DEBUG_PREFIX} convertCanvasQuestionToVariant: question_type raw="${questionTypeRaw}" normalized="${questionType}"; answers type=${typeof answersInput}, length=${answersInput?.length ?? 'N/A'}; question_text length=${questionTextRaw?.length ?? 0}`);

  // Extract description from question name first (used in all return paths)
  const descriptionMatch = questionName.match(/^\d+\.\s*(.+)$/);
  const description = descriptionMatch ? descriptionMatch[1].trim() : (questionName || 'Imported Question').trim();

  // Strip HTML tags from question text
  const questionText = stripHtmlTags(questionTextRaw);
  if (questionType === 'multiple_choice_question' && questionText) {
    console.log(`${DEBUG_PREFIX} convertCanvasQuestionToVariant: questionText after stripHtml (first 200 chars): ${questionText.slice(0, 200)}`);
  }

  let localType = 'SA';
  let processedQuestionText = questionText;
  let answer = null;
  let choices = null;

  // Match export types: multiple_choice_question, true_false_question, essay_question, short_answer_question
  if (questionType === 'multiple_choice_question' || questionType === 'true_false_question') {
    localType = 'MCQ';
    const answers = canvasQuestion.answers || [];
    const choicesList = [];
    let correctLetter = null;

    if (answers.length > 0) {
      console.log(`${DEBUG_PREFIX} convertCanvasQuestionToVariant: using answers array (${answers.length} items) for MCQ`);
      const correctAnswer = answers.find((a) => isCanvasAnswerCorrect(a));

      if (questionType === 'true_false_question') {
        choicesList.push({ letter: 'A', text: 'True' });
        choicesList.push({ letter: 'B', text: 'False' });
        if (correctAnswer) {
          const text = stripHtmlTags(getCanvasAnswerText(correctAnswer)).trim();
          correctLetter = text.toLowerCase() === 'true' ? 'A' : 'B';
        }
      } else {
        const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
        answers.forEach((ans, index) => {
          const letter = letters[index];
          const answerText = stripHtmlTags(getCanvasAnswerText(ans));
          choicesList.push({ letter, text: answerText });
          if (isCanvasAnswerCorrect(ans)) {
            correctLetter = letter;
          }
        });
      }

      processedQuestionText = questionText.trim();
      if (correctLetter) {
        answer = correctLetter;
      } else if (correctAnswer) {
        const text = stripHtmlTags(getCanvasAnswerText(correctAnswer));
        const letterMatch = text.match(/^([A-Za-z])/);
        answer = letterMatch ? letterMatch[1].toUpperCase() : null;
      }
      choices = choicesList.length > 0 ? choicesList : null;
    }

    // Fallback: when Canvas returns answers as null/empty (common for list or some instances), parse choices from question_text
    if (choices == null && (questionType === 'multiple_choice_question')) {
      const parsed = parseChoicesFromQuestionText(questionText);
      console.log(`${DEBUG_PREFIX} convertCanvasQuestionToVariant: fallback parseChoicesFromQuestionText => ${parsed.choices.length} choices`);
      if (parsed.choices.length > 0) {
        processedQuestionText = parsed.questionText;
        choices = parsed.choices;
        console.log(`${DEBUG_PREFIX} convertCanvasQuestionToVariant: MCQ result from fallback: choices=${JSON.stringify(choices)}, answer=${answer}`);
        // answer stays null; user can set correct answer after import
      } else {
        console.log(`${DEBUG_PREFIX} convertCanvasQuestionToVariant: fallback found no choices (pattern A) B) etc. not matched)`);
      }
    } else if (choices != null) {
      console.log(`${DEBUG_PREFIX} convertCanvasQuestionToVariant: MCQ result from answers: choices count=${choices.length}, answer=${answer}`);
    }

    return {
      questionText: processedQuestionText,
      answer: answer,
      choices,
      type: localType,
      description,
      position: canvasQuestion.position ?? 0
    };
  }

  if (questionType === 'essay_question') {
    localType = 'LA';
    const answers = canvasQuestion.answers || [];
    if (answers.length > 0) {
      const text = getCanvasAnswerText(answers[0]);
      if (text) answer = stripHtmlTags(text);
    }
    return {
      questionText: processedQuestionText,
      answer: answer,
      choices: null,
      type: localType,
      description,
      position: canvasQuestion.position ?? 0
    };
  }

  if (questionType === 'short_answer_question' || questionType === 'fill_in_multiple_blanks_question') {
    localType = 'SA';
    const answers = canvasQuestion.answers || [];
    if (answers.length > 0) {
      const text = getCanvasAnswerText(answers[0]);
      if (text) answer = stripHtmlTags(text);
    }
    return {
      questionText: processedQuestionText,
      answer: answer,
      choices: null,
      type: localType,
      description,
      position: canvasQuestion.position ?? 0
    };
  }

  throw new Error(`Unsupported question type: ${questionTypeRaw ?? 'unknown'}`);
};

/** Imports a Canvas quiz into a local assessment, creating sections/questions/variants. */
export const importQuizFromCanvas = async (userId, canvasCourseId, quizId, localCourseId, options = {}) => {
  try {
    const integration = await getCanvasIntegration(userId);
    
    if (!integration) {
      throw new Error('Canvas integration not configured. Please connect your Canvas account first.');
    }

    // Verify local course exists and belongs to user
    const course = await Course.findOne({
      where: { id: localCourseId, userId },
      attributes: ['id', 'name']
    });

    if (!course) {
      throw new Error('Local course not found');
    }

    // Get quiz details
    const quizResponse = await makeCanvasRequest(
      integration,
      'GET',
      `/courses/${canvasCourseId}/quizzes/${quizId}`
    );
    const quiz = quizResponse.data;

    // Get quiz questions
    const canvasQuestions = await getCanvasQuizQuestions(userId, canvasCourseId, quizId);

    if (canvasQuestions.length === 0) {
      throw new Error('Quiz has no questions to import');
    }

    // Determine assessment type from options or default
    const assessmentType = options.assessmentType || 'Quiz';
    const assessmentName = options.assessmentName || quiz.title || 'Imported Quiz';
    const semester = options.semester || new Date().getFullYear().toString();

    // Create assessment
    const assessment = await createAssessment(userId, {
      type: assessmentType,
      name: assessmentName,
      semester: semester,
      courseId: localCourseId,
      description: quiz.description || `Imported from Canvas: ${quiz.title}`
    });

    // Create a default section for all questions
    const section = await createAssessmentSection(assessment.id, userId, {
      name: 'Imported Questions',
      description: 'Questions imported from Canvas',
      position: 0
    });

    // Convert and import questions with graceful error handling
    const importedQuestions = [];
    const skippedQuestions = [];
    const primaryTopicId = options.primaryTopicId || null;

    if (!primaryTopicId) {
      throw new Error('Primary topic ID is required for importing questions. Please select a topic.');
    }

    for (let i = 0; i < canvasQuestions.length; i++) {
      const listItem = canvasQuestions[i];
      const questionId = listItem.id;

      console.log(`${DEBUG_PREFIX} importQuizFromCanvas: processing question ${i + 1}/${canvasQuestions.length} id=${questionId} type=${listItem.question_type} listItem.answers length=${listItem?.answers?.length ?? 'N/A'}`);

      try {
        // Fetch full question by ID so we get the answers array (list endpoint often returns answers: null)
        let canvasQuestion = listItem;
        if (questionId != null) {
          try {
            canvasQuestion = await getCanvasQuizQuestionById(userId, canvasCourseId, quizId, questionId);
            // Preserve position from list if full question doesn't have it
            if (canvasQuestion.position == null && listItem.position != null) {
              canvasQuestion = { ...canvasQuestion, position: listItem.position };
            }
            console.log(`${DEBUG_PREFIX} importQuizFromCanvas: after getById question ${i + 1}: answers length=${canvasQuestion?.answers?.length ?? 'N/A'}`);
          } catch (fetchErr) {
            console.log(`${DEBUG_PREFIX} importQuizFromCanvas: getCanvasQuizQuestionById failed for id=${questionId}: ${fetchErr.message}; using list item`);
            // Fall back to list item if per-question fetch fails (e.g. permissions)
            canvasQuestion = listItem;
          }
        }

        // Try to convert the question - this will throw if unsupported
        const converted = convertCanvasQuestionToVariant(canvasQuestion);
        console.log(`${DEBUG_PREFIX} importQuizFromCanvas: converted question ${i + 1} => type=${converted.type} choices count=${converted.choices?.length ?? 0} answer=${converted.answer ?? 'null'}`);

        // Create question metadata
        const questionMetadata = await Question_Metadata.create({
          courseId: localCourseId,
          primaryTopicId: primaryTopicId,
          type: converted.type,
          description: converted.description,
          questionOrder: {}
        });

        // Create variant
        console.log(`${DEBUG_PREFIX} importQuizFromCanvas: creating variant with answer=${converted.answer ?? 'null'}, choices count=${converted.choices?.length ?? 0}`);
        const variant = await Variants.create({
          questionMetadataId: questionMetadata.id,
          questionText: converted.questionText,
          difficulty: 'medium', // Default difficulty
          answer: converted.answer,
          choices: converted.choices || null, // Include choices for MCQ
          assessmentId: assessment.id,
          secondaryTopicsId: [],
          isAiGenerated: false,
          isDraft: true // Mark as draft for review
        });

        // Link variant to section
        await SectionVariants.create({
          sectionId: section.id,
          variantId: variant.id,
          displayOrder: converted.position || i
        });

        importedQuestions.push({
          questionMetadataId: questionMetadata.id,
          variantId: variant.id
        });
      } catch (error) {
        // If conversion or creation fails, skip this question but continue
        const questionName = canvasQuestion.question_name || `Question ${i + 1}`;
        const questionType = canvasQuestion.question_type || 'unknown';
        skippedQuestions.push({
          position: canvasQuestion.position || i + 1,
          name: questionName,
          type: questionType,
          reason: error.message || 'Unknown error'
        });
        // Continue to next question
        continue;
      }
    }

    // If no questions were imported at all, throw an error
    if (importedQuestions.length === 0) {
      throw new Error('No questions could be imported. All question types may be unsupported.');
    }

    // Save course mapping if it doesn't exist
    const courseMapping = await CanvasCourseMapping.findOne({
      where: {
        userId,
        localCourseId: localCourseId
      }
    });

    if (!courseMapping) {
      await CanvasCourseMapping.create({
        userId,
        localCourseId: localCourseId,
        canvasCourseId: canvasCourseId,
        canvasCourseName: integration.isTestMode ? 'Test Course' : undefined
      });
    }

    return {
      assessmentId: assessment.id,
      assessmentName: assessment.name,
      questionsImported: importedQuestions.length,
      questionsSkipped: skippedQuestions.length,
      skippedQuestions: skippedQuestions,
      sectionId: section.id
    };
  } catch (error) {
    throw new Error(`Failed to import quiz from Canvas: ${error.message}`);
  }
};

export { convertVariantToCanvasQuestion, parseMCQOptions };
