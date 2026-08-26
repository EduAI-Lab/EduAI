/**
 * #1545 — render + interaction coverage for QuestionPreviewSheet: null-question
 * short-circuit, MCQ choice/answer rendering, SA model-answer rendering, and
 * the two footer navigation actions.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { Question } from '@/types/question';

const navigate = vi.fn();
vi.mock('react-router', () => ({ useNavigate: () => navigate }));

const { QuestionPreviewSheet } = await import('@/components/question-bank/QuestionPreviewSheet');

function mcqQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 5,
    description: 'Capital of France',
    type: 'MCQ',
    courseId: 7,
    primaryTopicId: '1',
    questionOrder: null,
    createdAt: '',
    updatedAt: '',
    course: { id: 7, code: 'GEO101', name: 'Geography' } as Question['course'],
    primaryTopic: { name: 'Europe' } as Question['primaryTopic'],
    variants: [
      {
        id: 100,
        questionText: 'What is the capital of France?',
        difficulty: 'easy',
        referenceId: null,
        assessmentId: null,
        secondaryTopicsId: null,
        answer: 'B',
        choices: [
          { letter: 'A', text: 'Berlin' },
          { letter: 'B', text: 'Paris' },
        ],
        isAiGenerated: true,
        isDraft: false,
      },
    ] as unknown as Question['variants'],
    ...overrides,
  } as unknown as Question;
}

describe('QuestionPreviewSheet', () => {
  beforeEach(() => {
    cleanup();
    navigate.mockReset();
  });

  it('renders nothing when there is no question', () => {
    const { container } = render(
      <QuestionPreviewSheet question={null} open onOpenChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders question details, badges, and marks the correct MCQ choice', () => {
    render(<QuestionPreviewSheet question={mcqQuestion()} open onOpenChange={vi.fn()} />);

    expect(screen.getByText('Capital of France')).toBeInTheDocument();
    expect(screen.getByText('What is the capital of France?')).toBeInTheDocument();
    expect(screen.getByText('Paris')).toBeInTheDocument();
    expect(screen.getByText('Correct')).toBeInTheDocument();
    expect(screen.getByText('AI')).toBeInTheDocument();
    expect(screen.getByText(/GEO101/)).toBeInTheDocument();
  });

  it('renders the model answer instead of choices for a non-MCQ question', () => {
    const question = mcqQuestion({
      type: 'SA',
      variants: [
        {
          id: 101,
          questionText: 'Explain photosynthesis.',
          difficulty: 'medium',
          referenceId: null,
          assessmentId: null,
          secondaryTopicsId: null,
          answer: 'Plants convert light into energy.',
          choices: null,
          isAiGenerated: false,
          isDraft: true,
        },
      ] as unknown as Question['variants'],
    });
    render(<QuestionPreviewSheet question={question} open onOpenChange={vi.fn()} />);

    expect(screen.getByText('Model answer')).toBeInTheDocument();
    expect(screen.getByText('Plants convert light into energy.')).toBeInTheDocument();
    expect(screen.queryByText('AI')).not.toBeInTheDocument();
  });

  it('falls back to "Untitled question" and shows the no-prompt copy when data is missing', () => {
    const question = mcqQuestion({ description: null, variants: [] });
    render(<QuestionPreviewSheet question={question} open onOpenChange={vi.fn()} />);

    expect(screen.getByText('Untitled question')).toBeInTheDocument();
    expect(screen.getByText('No prompt text for this question yet.')).toBeInTheDocument();
  });

  it('navigates to the course and closes the sheet on "Open in course"', () => {
    const onOpenChange = vi.fn();
    render(<QuestionPreviewSheet question={mcqQuestion()} open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('button', { name: /open in course/i }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(navigate).toHaveBeenCalledWith('/courses/7?tab=questions');
  });

  it('navigates to a variant-of URL and closes the sheet on "Create variant" when a variant exists', () => {
    const onOpenChange = vi.fn();
    render(<QuestionPreviewSheet question={mcqQuestion()} open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('button', { name: /create variant/i }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(navigate).toHaveBeenCalledWith('/courses/7/questions/new?variantOf=5');
  });

  it('navigates to the plain "new question" URL when there is no variant yet', () => {
    const question = mcqQuestion({ variants: [] });
    render(<QuestionPreviewSheet question={question} open onOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /create variant/i }));

    expect(navigate).toHaveBeenCalledWith('/courses/7/questions/new');
  });
});
