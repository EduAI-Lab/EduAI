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

  it('renders the bank selector and new bank action', () => {
    render(
      <BankSelector
        banks={[
          { id: 'bank_default', courseId: 9, name: 'Course bank', isDefault: true },
          { id: 'bank_extra', courseId: 9, name: 'Extra', isDefault: false },
        ]}
        selectedBankId="bank_default"
        onBankChange={vi.fn()}
        onCreateBank={vi.fn()}
      />,
    );

    expect(screen.getByTestId('bank-selector')).toBeInTheDocument();
    expect(screen.getByText('New bank')).toBeInTheDocument();
  });

  it('creates a bank with the entered name', async () => {
    const onCreateBank = vi.fn().mockResolvedValue(undefined);
    render(
      <BankSelector
        banks={[{ id: 'bank_default', courseId: 9, name: 'Course bank', isDefault: true }]}
        selectedBankId="bank_default"
        onBankChange={vi.fn()}
        onCreateBank={onCreateBank}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /New bank/i }));
    fireEvent.change(screen.getByLabelText('New bank name'), {
      target: { value: 'Midterm bank' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Create$/ }));

    await waitFor(() => {
      expect(onCreateBank).toHaveBeenCalledWith('Midterm bank');
    });
  });
});
