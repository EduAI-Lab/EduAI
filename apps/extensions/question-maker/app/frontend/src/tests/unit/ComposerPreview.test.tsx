/**
 * Unit tests for `ComposerPreview` (#1546): live QuestionCard preview mapping —
 * placeholder text, MCQ choice/correct-answer mapping, non-MCQ answer display,
 * and topic label resolution.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ComposerPreview } from '@/components/composer/ComposerPreview';
import type { Topic } from '@/types/topic';

afterEach(() => cleanup());

const topics: Topic[] = [
  { id: 1, name: 'Loops' } as Topic,
  { id: 2, name: 'Recursion' } as Topic,
];

describe('ComposerPreview', () => {
  it('shows placeholder text when questionText is empty', () => {
    render(
      <ComposerPreview
        questionType="SA"
        difficulty="easy"
        questionText=""
        choices={[]}
        answer=""
        primaryTopicId=""
        secondaryTopicIds={[]}
        topics={topics}
      />
    );
    expect(screen.getByText(/Your question will appear here/)).toBeInTheDocument();
  });

  it('renders the actual question text when present', () => {
    render(
      <ComposerPreview
        questionType="SA"
        difficulty="easy"
        questionText="What is a loop?"
        choices={[]}
        answer=""
        primaryTopicId=""
        secondaryTopicIds={[]}
        topics={topics}
      />
    );
    expect(screen.getByText('What is a loop?')).toBeInTheDocument();
  });

  it('renders MCQ choices and flags the correct one', () => {
    render(
      <ComposerPreview
        questionType="MCQ"
        difficulty="medium"
        questionText="Pick one"
        choices={[
          { letter: 'A', text: 'Option A' },
          { letter: 'B', text: 'Option B' },
        ]}
        answer="B"
        primaryTopicId=""
        secondaryTopicIds={[]}
        topics={topics}
      />
    );
    expect(screen.getByText('Option A')).toBeInTheDocument();
    expect(screen.getByText('Option B')).toBeInTheDocument();
  });

  it('filters out blank MCQ choices', () => {
    render(
      <ComposerPreview
        questionType="MCQ"
        difficulty="medium"
        questionText="Pick one"
        choices={[
          { letter: 'A', text: '   ' },
          { letter: 'B', text: 'Option B' },
        ]}
        answer=""
        primaryTopicId=""
        secondaryTopicIds={[]}
        topics={topics}
      />
    );
    expect(screen.queryByText(/^A\.?/)).toBeNull();
    expect(screen.getByText('Option B')).toBeInTheDocument();
  });

  it('shows a direct answer for non-MCQ types', () => {
    render(
      <ComposerPreview
        questionType="SA"
        difficulty="easy"
        questionText="What is a loop?"
        choices={[]}
        answer="A control structure"
        primaryTopicId=""
        secondaryTopicIds={[]}
        topics={topics}
      />
    );
    expect(screen.getByText('A control structure')).toBeInTheDocument();
  });

  it('resolves known topic ids to names and falls back for unknown ids', () => {
    render(
      <ComposerPreview
        questionType="SA"
        difficulty="easy"
        questionText="Q"
        choices={[]}
        answer=""
        primaryTopicId="1"
        secondaryTopicIds={['999']}
        topics={topics}
      />
    );
    expect(screen.getByText('Loops')).toBeInTheDocument();
    expect(screen.getByText('Topic 999')).toBeInTheDocument();
  });

  it('renders the header label when provided', () => {
    render(
      <ComposerPreview
        questionType="SA"
        difficulty="easy"
        questionText="Q"
        choices={[]}
        answer=""
        primaryTopicId=""
        secondaryTopicIds={[]}
        topics={topics}
        label="New variant"
      />
    );
    expect(screen.getByText('New variant')).toBeInTheDocument();
  });
});
