/**
 * Unit tests for QuestionAIControls (#1545): model grouping, API key
 * save/change flow, generate button gating, and UBC-unavailable/course
 * warning banners.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QuestionAIControls } from '@/components/questions/QuestionAIControls';

afterEach(cleanup);

const models = [
  { id: 'vllm:qwen2.5-32b-instruct', label: 'Qwen 32B', provider: undefined },
  { id: 'google:gemini-2.5-flash', label: 'Gemini Flash', provider: 'google' },
] as any;

function baseProps(overrides: Partial<React.ComponentProps<typeof QuestionAIControls>> = {}) {
  return {
    value: { generationPrompt: '', generationModel: 'vllm:qwen2.5-32b-instruct' },
    onChange: vi.fn(),
    onGenerate: vi.fn(),
    isGenerating: false,
    availableModels: models,
    providerApiKey: '',
    onProviderApiKeyChange: vi.fn(),
    onSaveProviderApiKey: vi.fn(),
    keySaved: false,
    onClearSavedKey: vi.fn(),
    apiKeySaveState: 'idle' as const,
    status: 'ok' as const,
    statusMessage: undefined,
    statusProvider: undefined,
    onRefreshStatus: vi.fn(),
    questionGenerationPhase: undefined,
    courseWarningMessage: null,
    mode: 'new' as const,
    disabled: false,
    ...overrides,
  };
}

describe('QuestionAIControls', () => {
  it('renders the prompt label appropriate to mode', () => {
    render(<QuestionAIControls {...baseProps({ mode: 'variant' })} />);
    expect(screen.getByText('Spin a variant from a prompt')).toBeInTheDocument();
  });

  it('disables Generate when the prompt is empty', () => {
    render(<QuestionAIControls {...baseProps({ value: { generationPrompt: '', generationModel: 'vllm:qwen2.5-32b-instruct' } })} />);
    expect(screen.getByText('Generate question').closest('button')).toBeDisabled();
  });

  it('enables Generate and invokes onGenerate with a prompt', () => {
    const onGenerate = vi.fn();
    render(
      <QuestionAIControls
        {...baseProps({
          value: { generationPrompt: 'Explain recursion', generationModel: 'vllm:qwen2.5-32b-instruct' },
          onGenerate,
        })}
      />,
    );
    const btn = screen.getByText('Generate question').closest('button')!;
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onGenerate).toHaveBeenCalled();
  });

  it('shows "Generating…" while isGenerating is true', () => {
    render(
      <QuestionAIControls
        {...baseProps({
          value: { generationPrompt: 'x', generationModel: 'vllm:qwen2.5-32b-instruct' },
          isGenerating: true,
        })}
      />,
    );
    expect(screen.getByText('Generating…')).toBeInTheDocument();
  });

  it('shows the UBC-unavailable notice when status is error and a UBC model is selected', () => {
    render(<QuestionAIControls {...baseProps({ status: 'error' })} />);
    expect(screen.getByText(/UBC-hosted model unavailable/)).toBeInTheDocument();
  });

  it('does not show the UBC-unavailable notice for external models', () => {
    render(
      <QuestionAIControls
        {...baseProps({
          status: 'error',
          value: { generationPrompt: '', generationModel: 'google:gemini-2.5-flash' },
        })}
      />,
    );
    expect(screen.queryByText(/UBC-hosted model unavailable/)).not.toBeInTheDocument();
  });

  it('shows a course warning message when provided', () => {
    render(<QuestionAIControls {...baseProps({ courseWarningMessage: 'No course selected' })} />);
    expect(screen.getByText('No course selected')).toBeInTheDocument();
  });

  it('shows an API key input for a provider that requires a key', () => {
    render(
      <QuestionAIControls
        {...baseProps({ value: { generationPrompt: '', generationModel: 'google:gemini-2.5-flash' } })}
      />,
    );
    expect(screen.getByPlaceholderText(/Enter your GOOGLE API key/)).toBeInTheDocument();
  });

  it('saves the API key on click and via Enter key', () => {
    const onSaveProviderApiKey = vi.fn();
    render(
      <QuestionAIControls
        {...baseProps({
          value: { generationPrompt: '', generationModel: 'google:gemini-2.5-flash' },
          providerApiKey: 'secret-key',
          onSaveProviderApiKey,
        })}
      />,
    );
    fireEvent.click(screen.getByText('Save key'));
    expect(onSaveProviderApiKey).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByPlaceholderText(/Enter your GOOGLE API key/), { key: 'Enter' });
    expect(onSaveProviderApiKey).toHaveBeenCalledTimes(2);
  });

  it('shows a masked saved-key state with a Change button', () => {
    const onClearSavedKey = vi.fn();
    render(
      <QuestionAIControls
        {...baseProps({
          value: { generationPrompt: '', generationModel: 'google:gemini-2.5-flash' },
          keySaved: true,
          onClearSavedKey,
        })}
      />,
    );
    expect(screen.getByText('Key saved')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Change'));
    expect(onClearSavedKey).toHaveBeenCalled();
  });

  it('calls onChange when editing the prompt textarea', () => {
    const onChange = vi.fn();
    render(<QuestionAIControls {...baseProps({ onChange })} />);
    fireEvent.change(screen.getByPlaceholderText(/Time complexity of quicksort/), {
      target: { value: 'New prompt' },
    });
    expect(onChange).toHaveBeenCalledWith('generationPrompt', 'New prompt');
  });

  it('disables the model select when availableModels is empty', () => {
    render(<QuestionAIControls {...baseProps({ availableModels: [] })} />);
    expect(screen.getByRole('combobox')).toBeDisabled();
  });
});
