/**
 * Unit tests for HelpPage (#1544): search filtering, empty-search state,
 * shortcut list, and guided-tour relaunch wiring.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const { startTourMock } = vi.hoisted(() => ({ startTourMock: vi.fn() }));
vi.mock('@/contexts/GuidedTourContext', () => ({
  useGuidedTour: () => ({ startTour: startTourMock }),
}));

import { HelpPage } from '@/pages/HelpPage';

afterEach(cleanup);

describe('HelpPage', () => {
  it('renders all articles by default', () => {
    render(<HelpPage />);
    expect(screen.getByText('Before you start')).toBeInTheDocument();
    expect(screen.getByText('Tips & common issues')).toBeInTheDocument();
  });

  it('filters articles by title search', () => {
    render(<HelpPage />);
    const search = screen.getByLabelText('Search help topics');
    fireEvent.change(search, { target: { value: 'variants' } });
    expect(screen.getByText('Create variants of a question')).toBeInTheDocument();
    expect(screen.queryByText('Before you start')).not.toBeInTheDocument();
  });

  it('filters articles by keyword search', () => {
    render(<HelpPage />);
    const search = screen.getByLabelText('Search help topics');
    fireEvent.change(search, { target: { value: 'ocr' } });
    expect(screen.getByText('Upload PDF/Image → extract questions')).toBeInTheDocument();
  });

  it('shows a no-match message for unmatched search terms', () => {
    render(<HelpPage />);
    const search = screen.getByLabelText('Search help topics');
    fireEvent.change(search, { target: { value: 'zzzznomatch' } });
    expect(screen.getByText('No topics match “zzzznomatch”.')).toBeInTheDocument();
  });

  it('renders the keyboard shortcuts list', () => {
    render(<HelpPage />);
    expect(screen.getByText('Open command palette')).toBeInTheDocument();
    expect(screen.getByText('Save in composer')).toBeInTheDocument();
  });

  it('starts the guided tour when the relaunch button is clicked', () => {
    render(<HelpPage />);
    fireEvent.click(screen.getByText('Relaunch guided tour'));
    expect(startTourMock).toHaveBeenCalledWith('main');
  });
});
