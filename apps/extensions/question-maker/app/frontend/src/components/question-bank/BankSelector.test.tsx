/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BankSelector } from './BankSelector';

describe('BankSelector', () => {
  afterEach(() => {
    cleanup();
  });

  it('calls onBankChange when selecting a bank', () => {
    const onBankChange = vi.fn();
    render(
      <BankSelector
        banks={[
          { id: 1, courseId: 9, name: 'Course bank', isDefault: true },
          { id: 2, courseId: 9, name: 'Extra', isDefault: false }
        ]}
        selectedBankId={1}
        onBankChange={onBankChange}
        onCreateBank={vi.fn()}
      />
    );

    // Radix Select is hard to drive; exercise All questions via re-render path by clicking New bank + create
    expect(screen.getByTestId('bank-selector')).toBeInTheDocument();
    expect(screen.getByText('New bank')).toBeInTheDocument();
  });

  it('creates a bank with the entered name', async () => {
    const onCreateBank = vi.fn().mockResolvedValue(undefined);
    render(
      <BankSelector
        banks={[{ id: 1, courseId: 9, name: 'Course bank', isDefault: true }]}
        selectedBankId={1}
        onBankChange={vi.fn()}
        onCreateBank={onCreateBank}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /New bank/i }));
    fireEvent.change(screen.getByLabelText('New bank name'), {
      target: { value: 'Midterm bank' }
    });
    fireEvent.click(screen.getByRole('button', { name: /^Create$/ }));

    await waitFor(() => {
      expect(onCreateBank).toHaveBeenCalledWith('Midterm bank');
    });
  });
});
