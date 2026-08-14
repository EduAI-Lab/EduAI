/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CourseBanksTab } from './CourseBanksTab';

describe('CourseBanksTab', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows loading skeletons', () => {
    const { container } = render(
      <CourseBanksTab
        banks={[]}
        canWrite
        isLoading
        onCreateBank={vi.fn()}
        onSyncFromCanvas={vi.fn()}
        onOpenBank={vi.fn()}
      />,
    );
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders empty state and create/sync actions when writable', () => {
    render(
      <CourseBanksTab
        banks={[]}
        canWrite
        onCreateBank={vi.fn()}
        onSyncFromCanvas={vi.fn()}
        onOpenBank={vi.fn()}
      />,
    );
    expect(screen.getByText(/No question banks yet/i)).toBeInTheDocument();
    expect(screen.getByTestId('banks-tab-new-bank')).toBeInTheDocument();
    expect(screen.getByTestId('sync-canvas-bank-btn')).toBeInTheDocument();
  });

  it('opens a bank on card click', () => {
    const onOpenBank = vi.fn();
    render(
      <CourseBanksTab
        banks={[
          {
            id: 'bank_1',
            courseId: 9,
            name: 'Midterm',
            description: null,
            isDefault: false,
          },
        ]}
        canWrite={false}
        onCreateBank={vi.fn()}
        onSyncFromCanvas={vi.fn()}
        onOpenBank={onOpenBank}
      />,
    );

    fireEvent.click(screen.getByText('Midterm'));
    expect(onOpenBank).toHaveBeenCalledWith('bank_1');
  });

  it('creates a bank from the inline form', async () => {
    const onCreateBank = vi.fn().mockResolvedValue(undefined);
    render(
      <CourseBanksTab
        banks={[]}
        canWrite
        onCreateBank={onCreateBank}
        onSyncFromCanvas={vi.fn()}
        onOpenBank={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('banks-tab-new-bank'));
    fireEvent.change(screen.getByPlaceholderText(/bank name/i), {
      target: { value: ' Quiz prep ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(onCreateBank).toHaveBeenCalledWith('Quiz prep');
    });
  });

  it('calls onSyncFromCanvas', () => {
    const onSyncFromCanvas = vi.fn();
    render(
      <CourseBanksTab
        banks={[]}
        canWrite
        onCreateBank={vi.fn()}
        onSyncFromCanvas={onSyncFromCanvas}
        onOpenBank={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('sync-canvas-bank-btn'));
    expect(onSyncFromCanvas).toHaveBeenCalled();
  });
});
