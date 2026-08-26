/**
 * Coverage for QuestionMetadataPanel (#1545) — type/topic/difficulty/reasoning
 * selects, secondary-topic multi-select, variant-mode read-only fields, and the
 * description/assessment row. No service mocks needed; purely presentational.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { QuestionMetadataPanel } from '@/components/questions/QuestionMetadataPanel';
import type { Topic } from '@/types/topic';
import type { Assessment } from '@/types/question';

window.HTMLElement.prototype.scrollIntoView = vi.fn();

const topics: Topic[] = [
  { id: 1, name: 'Sorting' } as unknown as Topic,
  { id: 2, name: 'Graphs' } as unknown as Topic,
];
const assessments: Assessment[] = [
  { id: 10, name: 'Midterm', type: 'Midterm' } as unknown as Assessment,
];

function baseValue(overrides: Partial<Parameters<typeof QuestionMetadataPanel>[0]['value']> = {}) {
  return {
    questionType: 'MCQ' as const,
    primaryTopicId: '1',
    questionDescription: '',
    variantDifficulty: 'medium' as const,
    variantReasoningLevel: 'factual' as const,
    variantSecondaryTopics: [],
    variantAssessmentId: 'none',
    ...overrides,
  };
}

function renderPanel(overrides: Partial<React.ComponentProps<typeof QuestionMetadataPanel>> = {}) {
  const onChange = vi.fn();
  const onToggleSecondaryTopic = vi.fn();
  render(
    <QuestionMetadataPanel
      value={baseValue()}
      onChange={onChange}
      topics={topics}
      assessments={assessments}
      mode="new"
      onToggleSecondaryTopic={onToggleSecondaryTopic}
      {...overrides}
    />,
  );
  return { onChange, onToggleSecondaryTopic };
}

describe('QuestionMetadataPanel', () => {
  beforeEach(() => cleanup());

  it('renders editable type and primary topic selects in "new" mode', () => {
    renderPanel();
    // Selects render as comboboxes; Type + Primary Topic + Difficulty + Reasoning + Assessment = 5.
    expect(screen.getAllByRole('combobox').length).toBeGreaterThanOrEqual(5);
  });

  it('shows read-only type and topic text in "variant" mode', () => {
    renderPanel({ mode: 'variant', primaryTopicName: 'Sorting' });

    expect(screen.getByText('Multiple Choice')).toBeInTheDocument();
    expect(screen.getByText('Sorting')).toBeInTheDocument();
  });

  it('shows a "no topics" hint when the topic list is empty', () => {
    renderPanel({ topics: [] });
    expect(screen.getByText(/no topics yet/i)).toBeInTheDocument();
  });

  it('changes difficulty via the select', () => {
    const { onChange } = renderPanel();
    const difficultyLabel = screen.getByText('Difficulty');
    const difficultyTrigger = difficultyLabel.parentElement!.querySelector(
      '[role="combobox"]',
    ) as HTMLElement;
    fireEvent.click(difficultyTrigger);
    fireEvent.click(screen.getByText('hard'));
    expect(onChange).toHaveBeenCalledWith('variantDifficulty', 'hard');
  });

  it('edits the description textarea', () => {
    const { onChange } = renderPanel();
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'A short label' } });
    expect(onChange).toHaveBeenCalledWith('questionDescription', 'A short label');
  });

  it('offers assessments in the assessment select, plus a "no assessment" option', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('combobox', { name: /assessment/i }));
    expect(screen.getAllByText('No assessment').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Midterm (Midterm)')).toBeInTheDocument();
  });

  it('shows a "no assessments available" placeholder when there are none', () => {
    renderPanel({ assessments: [] });
    fireEvent.click(screen.getByRole('combobox', { name: /assessment/i }));
    expect(screen.getByText('No assessments available')).toBeInTheDocument();
  });

  it('renders the secondary-topics multi-select', () => {
    renderPanel();
    expect(screen.getByText('Select secondary topics')).toBeInTheDocument();
  });
});
