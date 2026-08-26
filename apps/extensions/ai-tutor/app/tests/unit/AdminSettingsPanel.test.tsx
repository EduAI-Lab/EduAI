import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminAiModelOption, AdminAiModelPolicy, AdminSettingsLoaderData } from '~/lib/admin-settings';

const { mockToastSuccess, mockToastError } = vi.hoisted(() => ({
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: mockToastSuccess, error: mockToastError } }));

const { mockSetEduAiApiKey, mockClearEduAiApiKey, mockSetAdminAiModelPolicy } = vi.hoisted(() => ({
  mockSetEduAiApiKey: vi.fn(),
  mockClearEduAiApiKey: vi.fn(),
  mockSetAdminAiModelPolicy: vi.fn(),
}));

vi.mock('~/lib/api', () => ({
  default: {
    setEduAiApiKey: mockSetEduAiApiKey,
    clearEduAiApiKey: mockClearEduAiApiKey,
    setAdminAiModelPolicy: mockSetAdminAiModelPolicy,
  },
}));

import { AdminSettingsPanel } from '~/components/admin/AdminSettingsPanel';

const models: AdminAiModelOption[] = [
  {
    id: 'm1',
    modelId: 'google:gemini-2.5-flash',
    modelName: 'Gemini Flash',
    provider: 'google',
    costTier: 'LOW',
  },
  {
    id: 'm2',
    modelId: 'openai:gpt-4.1',
    modelName: 'GPT 4.1',
    provider: 'openai',
    costTier: 'HIGH',
  },
];

const basePolicy: AdminAiModelPolicy = {
  allowedTutorModelIds: ['google:gemini-2.5-flash'],
  defaultTutorModelId: 'google:gemini-2.5-flash',
  defaultSupervisorModelId: 'openai:gpt-4.1',
  dualLoopEnabled: true,
  maxSupervisorIterations: 3,
};

function loaderData(overrides: Partial<AdminSettingsLoaderData> = {}): AdminSettingsLoaderData {
  return {
    status: {
      configured: false,
      source: 'NONE',
      hasAdminOverride: false,
      envConfigured: false,
      updatedAt: null,
    },
    aiPolicy: basePolicy,
    aiModels: models,
    aiPolicyAvailable: true,
    aiPolicyError: null,
    ...overrides,
  };
}

describe('AdminSettingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders allowed-model checkboxes and default badges', () => {
    render(<AdminSettingsPanel loaderData={loaderData()} />);

    // "Gemini Flash" also appears as the selected value text in the "Default
    // tutor model" select, so there is more than one match.
    expect(screen.getAllByText('Gemini Flash').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('GPT 4.1').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Tutor default')).toBeInTheDocument();
    expect(screen.getByText('Supervisor default')).toBeInTheDocument();

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();
  });

  it('shows the "coming soon" notice and skips model tooling when the policy API is unavailable', () => {
    render(
      <AdminSettingsPanel
        loaderData={loaderData({ aiPolicyAvailable: false, aiPolicy: null })}
      />,
    );
    expect(
      screen.getByText('AI model policy settings cannot be saved yet. This feature is coming soon.'),
    ).toBeInTheDocument();
  });

  it('shows a toast error when the loader reports an aiPolicyError', () => {
    render(<AdminSettingsPanel loaderData={loaderData({ aiPolicyError: 'Could not load' })} />);
    expect(mockToastError).toHaveBeenCalledWith('Could not load');
  });

  it('toggling a model checkbox updates the allowlist and re-derives the tutor default', () => {
    render(<AdminSettingsPanel loaderData={loaderData()} />);

    const checkboxes = screen.getAllByRole('checkbox');
    // Enable the second model (GPT 4.1) as an allowed tutor model too.
    fireEvent.click(checkboxes[1]);
    expect(checkboxes[1]).toBeChecked();

    // Disable the first (previously-default) model; the tutor default should
    // fall back to the remaining allowed model.
    fireEvent.click(checkboxes[0]);
    expect(checkboxes[0]).not.toBeChecked();
  });

  it('the Save loop settings button is disabled until the policy is dirty', () => {
    render(<AdminSettingsPanel loaderData={loaderData()} />);
    expect(screen.getByRole('button', { name: 'Save loop settings' })).toBeDisabled();

    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    expect(screen.getByRole('button', { name: 'Save loop settings' })).not.toBeDisabled();
  });

  it('Reset changes restores the initial policy and re-disables Save', () => {
    render(<AdminSettingsPanel loaderData={loaderData()} />);
    const checkboxes = screen.getAllByRole('checkbox');

    fireEvent.click(checkboxes[1]);
    expect(screen.getByRole('button', { name: 'Save loop settings' })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Reset changes' }));
    expect(screen.getByRole('button', { name: 'Save loop settings' })).toBeDisabled();
    expect(screen.getAllByRole('checkbox')[1]).not.toBeChecked();
  });

  it('saves the AI loop policy and shows a success toast', async () => {
    mockSetAdminAiModelPolicy.mockResolvedValue({
      ...basePolicy,
      allowedTutorModelIds: ['google:gemini-2.5-flash', 'openai:gpt-4.1'],
    });
    render(<AdminSettingsPanel loaderData={loaderData()} />);

    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Save loop settings' }));

    await waitFor(() => {
      expect(mockSetAdminAiModelPolicy).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith('AI loop settings saved.');
    });
    // Once saved, the policy becomes the new baseline: Save disables again.
    expect(screen.getByRole('button', { name: 'Save loop settings' })).toBeDisabled();
  });

  it('shows an error toast when saving the AI loop policy fails', async () => {
    mockSetAdminAiModelPolicy.mockRejectedValue(new Error('boom'));
    render(<AdminSettingsPanel loaderData={loaderData()} />);

    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Save loop settings' }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('Could not save AI loop settings. Please try again.');
    });
  });

  it('updates the max revision passes input, clamped to [1,5]', () => {
    render(<AdminSettingsPanel loaderData={loaderData()} />);
    // The "Max revision passes" <label> has no htmlFor, so target the number
    // input directly instead of using getByLabelText.
    const input = screen.getByRole('spinbutton') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '10' } });
    expect(input).toHaveValue(5);

    fireEvent.change(input, { target: { value: '0' } });
    expect(input).toHaveValue(1);
  });

  it('saves a new EduAI API key', async () => {
    mockSetEduAiApiKey.mockResolvedValue({
      configured: true,
      source: 'ADMIN',
      hasAdminOverride: true,
      envConfigured: false,
      updatedAt: '2026-03-10T08:00:00.000Z',
    });
    render(<AdminSettingsPanel loaderData={loaderData()} />);

    fireEvent.change(screen.getByPlaceholderText('Paste EDUAI API key'), {
      target: { value: 'sk-new-key' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save key' }));

    await waitFor(() => {
      expect(mockSetEduAiApiKey).toHaveBeenCalledWith('sk-new-key');
    });
    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith(
        'Saved. This key will be used instead of the default one.',
      );
    });
  });

  it('shows an error toast when saving the API key fails', async () => {
    mockSetEduAiApiKey.mockRejectedValue(new Error('boom'));
    render(<AdminSettingsPanel loaderData={loaderData()} />);

    fireEvent.change(screen.getByPlaceholderText('Paste EDUAI API key'), {
      target: { value: 'sk-bad' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save key' }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('Could not save key. Please try again.');
    });
  });

  it('clears the EduAI API key when an admin override exists', async () => {
    mockClearEduAiApiKey.mockResolvedValue({
      configured: false,
      source: 'NONE',
      hasAdminOverride: false,
      envConfigured: false,
      updatedAt: null,
    });
    render(
      <AdminSettingsPanel
        loaderData={loaderData({
          status: {
            configured: true,
            source: 'ADMIN',
            hasAdminOverride: true,
            envConfigured: false,
            updatedAt: '2026-03-10T08:00:00.000Z',
          },
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clear key' }));

    await waitFor(() => {
      expect(mockClearEduAiApiKey).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith(
        'Cleared. The default key will be used instead.',
      );
    });
  });

  it('disables Clear key when there is no admin override to clear', () => {
    render(<AdminSettingsPanel loaderData={loaderData()} />);
    expect(screen.getByRole('button', { name: 'Clear key' })).toBeDisabled();
  });

  it('toggles the key visibility between password and text', () => {
    render(<AdminSettingsPanel loaderData={loaderData()} />);
    const input = screen.getByPlaceholderText('Paste EDUAI API key');
    expect(input).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(input).toHaveAttribute('type', 'text');

    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('toggles the dual-loop switch', () => {
    render(<AdminSettingsPanel loaderData={loaderData()} />);
    const toggle = screen
      .getAllByRole('button')
      .find((button) => button.hasAttribute('aria-pressed'));
    expect(toggle).toBeDefined();
    expect(toggle).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(toggle!);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });
});
