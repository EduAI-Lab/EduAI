/**
 * AI configuration block: status badge, prompt, model, difficulty/reasoning, API key, Generate button.
 * For use in AddQuestionDialog right column (prototype-style layout).
 */
import { Label, Button, Input, Textarea } from '@eduai/ui';

import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@eduai/ui';
import { AIServiceIndicators } from '../eduai/AIServiceIndicators';
import { apiKeyStorage } from '../../services/apiKeyStorage';
import { IconSparkles, IconCircleCheck } from '@tabler/icons-react';
import type { EduAIModelOption } from '../../services/eduaiService';
import type { QuestionGenerationPhase } from '../../hooks/useEduAIStatus';
import { isCampusModel } from '../../utils/aiModels';

export interface QuestionAIControlsValue {
    generationPrompt: string;
    generationModel: string;
}

interface QuestionAIControlsProps {
    value: QuestionAIControlsValue;
    onChange: <K extends keyof QuestionAIControlsValue>(
        field: K,
        value: QuestionAIControlsValue[K]
    ) => void;
    onGenerate: () => void;
    isGenerating: boolean;
    availableModels: EduAIModelOption[];
    /** Draft input buffer for entering a NEW key (not the persisted key). */
    providerApiKey: string;
    onProviderApiKeyChange: (value: string) => void;
    onSaveProviderApiKey?: () => void;
    /** True when a key for the selected provider is already persisted in this browser. */
    keySaved?: boolean;
    /** Clears the persisted key so the user can enter a new one. */
    onClearSavedKey?: () => void;
    apiKeySaveState?: 'idle' | 'saving' | 'saved' | 'error';
    status: 'loading' | 'ok' | 'error';
    statusMessage?: string;
    statusProvider?: 'google' | 'ollama';
    onRefreshStatus: () => void;
    questionGenerationPhase?: QuestionGenerationPhase;
    courseWarningMessage: string | null;
    mode: 'new' | 'variant';
    disabled?: boolean;
}

export function QuestionAIControls({
    value,
    onChange,
    onGenerate,
    isGenerating,
    availableModels,
    providerApiKey,
    onProviderApiKeyChange,
    onSaveProviderApiKey,
    keySaved = false,
    onClearSavedKey,
    apiKeySaveState = 'idle',
    status,
    statusMessage,
    statusProvider,
    onRefreshStatus,
    questionGenerationPhase,
    courseWarningMessage,
    mode,
    disabled = false
}: QuestionAIControlsProps) {
    const isUbcModel =
        value.generationModel.startsWith('ollama') || value.generationModel.startsWith('vllm');
    const isExternal = !isUbcModel;
    const requiresKey = apiKeyStorage.requiresApiKey(value.generationModel);
    const providerName = apiKeyStorage.getProviderFromModel(value.generationModel);

    return (
        <div className="relative overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card p-5 space-y-4 shadow-[var(--shadow-2xs)]" data-tour-id="aq-eduai-panel">
            {/* Colourful top-accent strip — signals the AI surface */}
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-secondary to-accent" />
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-secondary to-accent text-white shadow-[var(--shadow-sm)]">
                        <IconSparkles className="size-5" aria-hidden />
                    </span>
                    <div className="flex flex-col">
                        <h2 className="text-sm font-semibold text-foreground">AI assist</h2>
                        <p className="text-xs text-muted-foreground">
                            {mode === 'variant' ? 'Spin a variant from a prompt' : 'Draft a question from a prompt'}
                        </p>
                    </div>
                </div>
                <AIServiceIndicators
                    status={status}
                    message={statusMessage}
                    provider={statusProvider}
                    onRefresh={onRefreshStatus}
                    questionGenerationPhase={mode === 'variant' ? questionGenerationPhase : undefined}
                    className="z-50"
                />
            </div>

            {/* AI Model selector — folded in from Advanced Options */}
            <div className="space-y-1.5" data-tour-id="aq-model-picker">
                <Label htmlFor="ai-model" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    AI Model
                </Label>
                <Select
                    value={value.generationModel}
                    onValueChange={(v) => onChange('generationModel', v)}
                    disabled={disabled || availableModels.length === 0}
                >
                    <SelectTrigger id="ai-model" className="h-9">
                        <SelectValue placeholder="Select model" />
                    </SelectTrigger>
                    <SelectContent>
                        {availableModels.length === 0 ? (
                            <SelectItem value="__no_models" disabled>No models available</SelectItem>
                        ) : (
                            <>
                                {availableModels.some((m) => isCampusModel(m)) && (
                                    <div className="px-2 py-1.5 text-[11px] font-semibold text-muted-foreground">UBC Hosted</div>
                                )}
                                {availableModels.filter((m) => isCampusModel(m)).map((m) => (
                                    <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                                ))}
                                {availableModels.some((m) => !isCampusModel(m)) && (
                                    <div className="px-2 py-1.5 text-[11px] font-semibold text-muted-foreground">External</div>
                                )}
                                {availableModels.filter((m) => !isCampusModel(m)).map((m) => (
                                    <SelectItem key={m.id} value={m.id}>{m.label}{m.provider ? ` (${m.provider})` : ''}</SelectItem>
                                ))}
                            </>
                        )}
                    </SelectContent>
                </Select>
            </div>

            {/* UBC-hosted unavailable notice — only relevant when a UBC model is selected,
                so it doesn't flicker in/out for cloud users on every status re-check. */}
            {status === 'error' && isUbcModel && (
                <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                    <span className="font-semibold">UBC-hosted model unavailable.</span>{' '}
                    Connect to UBC wifi/VPN, or pick a cloud model above and add its API key.
                </div>
            )}

            {courseWarningMessage && (
                <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-2 py-1.5 text-xs text-amber-800 dark:text-amber-200">
                    {courseWarningMessage}
                </div>
            )}

            <div className="space-y-1.5" data-tour-id="aq-ai-prompt">
                <Label htmlFor="ai-prompt" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Prompt
                </Label>
                <Textarea
                    id="ai-prompt"
                    value={value.generationPrompt}
                    onChange={(e) => onChange('generationPrompt', e.target.value)}
                    placeholder={
                        mode === 'variant'
                            ? 'e.g., Make it harder and focus on edge cases'
                            : 'e.g., Time complexity of quicksort'
                    }
                    disabled={disabled}
                    className="resize-none text-sm min-h-16"
                    rows={3}
                />
            </div>

            {requiresKey && providerName && (
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <Label htmlFor="provider-api-key" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                            {providerName.toUpperCase()} API Key
                        </Label>
                        {keySaved && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                                <IconCircleCheck className="size-3.5" aria-hidden />
                                Key saved
                            </span>
                        )}
                    </div>
                    {keySaved ? (
                        // A key is persisted — never reveal it; show a placeholder + Change.
                        <div className="flex items-center gap-2">
                            <Input
                                id="provider-api-key"
                                type="text"
                                value={'•'.repeat(24)}
                                disabled
                                aria-label={`${providerName.toUpperCase()} API key saved`}
                                className="h-9 text-xs flex-1 tracking-widest"
                            />
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={onClearSavedKey}
                            >
                                Change
                            </Button>
                        </div>
                    ) : (
                        // No persisted key — typing here only fills the draft; nothing is
                        // stored until the user explicitly clicks Save.
                        <div className="flex items-center gap-2">
                            <Input
                                id="provider-api-key"
                                type="password"
                                placeholder={`Enter your ${providerName.toUpperCase()} API key`}
                                value={providerApiKey}
                                className="h-9 text-xs flex-1"
                                onChange={(e) => onProviderApiKeyChange(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && providerApiKey.trim() && apiKeySaveState !== 'saving') {
                                        e.preventDefault();
                                        onSaveProviderApiKey?.();
                                    }
                                }}
                            />
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={!providerApiKey.trim() || apiKeySaveState === 'saving'}
                                onClick={onSaveProviderApiKey}
                            >
                                {apiKeySaveState === 'saving' ? 'Saving…' : 'Save key'}
                            </Button>
                        </div>
                    )}
                    {/* Compact muted notes — replaces the bulky amber warning box to cut clutter. */}
                    <p className="text-[11px] text-muted-foreground">
                        Stored locally in your browser, never sent to our servers.
                        {isExternal && ' External models receive your prompt and course data.'}
                    </p>
                </div>
            )}

            <Button
                type="button"
                onClick={onGenerate}
                disabled={disabled || isGenerating || !value.generationPrompt.trim()}
                className="w-full gap-2 border-0 bg-gradient-to-r from-secondary to-accent text-white shadow-[var(--shadow-sm)] transition-opacity hover:opacity-95 disabled:opacity-50"
                data-tour-id="aq-ai-generate"
            >
                <IconSparkles className="size-4" aria-hidden />
                {isGenerating ? 'Generating…' : mode === 'variant' ? 'Generate variant' : 'Generate question'}
            </Button>
        </div>
    );
}
