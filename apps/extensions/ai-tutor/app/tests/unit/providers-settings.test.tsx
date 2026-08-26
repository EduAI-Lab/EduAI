import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseApiKeys = vi.fn();
vi.mock('~/hooks/use-api-keys', () => ({
  useApiKeys: () => mockUseApiKeys(),
}));

import { ProvidersSettings } from '~/components/settings/providers-settings';

function apiKeysState(overrides: Partial<ReturnType<typeof mockUseApiKeys>> = {}) {
  return {
    loaded: true,
    keys: {},
    hasKey: vi.fn(() => false),
    getKey: vi.fn(() => ''),
    setKey: vi.fn(),
    removeKey: vi.fn(),
    validateKey: vi.fn(),
    ...overrides,
  };
}

describe('ProvidersSettings', () => {
  beforeEach(() => {
    mockUseApiKeys.mockReset();
  });

  it('renders each provider with a "Get a key" link when unconfigured', () => {
    mockUseApiKeys.mockReturnValue(apiKeysState());
    render(<ProvidersSettings />);

    expect(screen.getByText('Gemini')).toBeInTheDocument();
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
    expect(screen.getAllByText('Get a key').length).toBe(3);
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
  });

  it('shows a masked key and Remove button when a provider is configured', () => {
    mockUseApiKeys.mockReturnValue(
      apiKeysState({
        hasKey: vi.fn((p: string) => p === 'google'),
        getKey: vi.fn(() => 'sk-abcdefgh1234'),
      }),
    );
    render(<ProvidersSettings />);

    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText(/••••••1234/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remove/ })).toBeInTheDocument();
  });

  it('removeKey is called when Remove is clicked', () => {
    const removeKey = vi.fn();
    mockUseApiKeys.mockReturnValue(
      apiKeysState({ hasKey: vi.fn(() => true), getKey: vi.fn(() => 'sk-xxxxxxxx1234'), removeKey }),
    );
    render(<ProvidersSettings />);

    fireEvent.click(screen.getAllByRole('button', { name: /Remove/ })[0]);
    expect(removeKey).toHaveBeenCalled();
  });

  it('validates and saves a new key on Save', async () => {
    const setKey = vi.fn();
    const validateKey = vi.fn().mockResolvedValue({ valid: true });
    mockUseApiKeys.mockReturnValue(apiKeysState({ setKey, validateKey }));
    render(<ProvidersSettings />);

    const inputs = screen.getAllByPlaceholderText(/Enter your .* API key/);
    fireEvent.change(inputs[0], { target: { value: 'sk-my-new-key' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);

    await waitFor(() => {
      expect(validateKey).toHaveBeenCalledWith('google', 'sk-my-new-key');
    });
    await waitFor(() => {
      expect(setKey).toHaveBeenCalledWith('google', 'sk-my-new-key');
    });
  });

  it('shows a validation error and does not save when the key is invalid', async () => {
    const setKey = vi.fn();
    const validateKey = vi.fn().mockResolvedValue({ valid: false, error: 'Invalid API key' });
    mockUseApiKeys.mockReturnValue(apiKeysState({ setKey, validateKey }));
    render(<ProvidersSettings />);

    const inputs = screen.getAllByPlaceholderText(/Enter your .* API key/);
    fireEvent.change(inputs[0], { target: { value: 'bad-key' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);

    expect(await screen.findByText('Invalid API key')).toBeInTheDocument();
    expect(setKey).not.toHaveBeenCalled();
  });

  it('shows a generic error when validation throws', async () => {
    const validateKey = vi.fn().mockRejectedValue(new Error('network'));
    mockUseApiKeys.mockReturnValue(apiKeysState({ validateKey }));
    render(<ProvidersSettings />);

    const inputs = screen.getAllByPlaceholderText(/Enter your .* API key/);
    fireEvent.change(inputs[0], { target: { value: 'sk-key' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);

    expect(await screen.findByText('Could not validate API key')).toBeInTheDocument();
  });

  it('disables Save until a draft key is entered', () => {
    mockUseApiKeys.mockReturnValue(apiKeysState());
    render(<ProvidersSettings />);

    const saveButtons = screen.getAllByRole('button', { name: 'Save' });
    expect(saveButtons[0]).toBeDisabled();

    const inputs = screen.getAllByPlaceholderText(/Enter your .* API key/);
    fireEvent.change(inputs[0], { target: { value: 'x' } });
    expect(saveButtons[0]).not.toBeDisabled();
  });
});
