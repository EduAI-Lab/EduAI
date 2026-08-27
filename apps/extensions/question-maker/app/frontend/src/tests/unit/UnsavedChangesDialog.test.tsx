/**
 * Unit tests for `UnsavedChangesDialog` (#1546): the OCR upload flow's exit
 * guard — Keep Editing / Discard / Save Questions actions and their disabled
 * states.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { UnsavedChangesDialog } from '@/components/ocr/UnsavedChangesDialog';

afterEach(() => cleanup());

const baseProps = {
  open: true,
  questionsCount: 3,
  canSave: true,
  isSaving: false,
  onSave: vi.fn(),
  onDiscard: vi.fn(),
  onCancel: vi.fn(),
};

describe('UnsavedChangesDialog', () => {
  it('renders nothing when closed', () => {
    render(<UnsavedChangesDialog {...baseProps} open={false} />);
    expect(screen.queryByText('Unsaved Questions')).toBeNull();
  });

  it('shows the question count with correct pluralization', () => {
    render(<UnsavedChangesDialog {...baseProps} questionsCount={1} />);
    expect(screen.getByText(/1 extracted question(?!s)/)).toBeInTheDocument();
  });

  it('pluralizes for more than one question', () => {
    render(<UnsavedChangesDialog {...baseProps} questionsCount={5} />);
    expect(screen.getByText(/5 extracted questions/)).toBeInTheDocument();
  });

  it('calls onCancel when Keep Editing is clicked', () => {
    const onCancel = vi.fn();
    render(<UnsavedChangesDialog {...baseProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Keep Editing'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('calls onDiscard when Discard is clicked', () => {
    const onDiscard = vi.fn();
    render(<UnsavedChangesDialog {...baseProps} onDiscard={onDiscard} />);
    fireEvent.click(screen.getByText('Discard'));
    expect(onDiscard).toHaveBeenCalled();
  });

  it('calls onSave when Save Questions is enabled and clicked', () => {
    const onSave = vi.fn();
    render(<UnsavedChangesDialog {...baseProps} onSave={onSave} canSave />);
    fireEvent.click(screen.getByText('Save Questions'));
    expect(onSave).toHaveBeenCalled();
  });

  it('disables Save Questions when canSave is false', () => {
    render(<UnsavedChangesDialog {...baseProps} canSave={false} />);
    expect(screen.getByText('Save Questions').closest('button')).toBeDisabled();
  });

  it('shows "Saving..." and disables all actions while isSaving', () => {
    render(<UnsavedChangesDialog {...baseProps} isSaving />);
    expect(screen.getByText('Saving...')).toBeInTheDocument();
    expect(screen.getByText('Keep Editing').closest('button')).toBeDisabled();
    expect(screen.getByText('Discard').closest('button')).toBeDisabled();
    expect(screen.getByText('Saving...').closest('button')).toBeDisabled();
  });

  it('calls onCancel when the dialog is dismissed via Escape (onOpenChange(false))', () => {
    const onCancel = vi.fn();
    render(<UnsavedChangesDialog {...baseProps} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByText('Unsaved Questions'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });
});
