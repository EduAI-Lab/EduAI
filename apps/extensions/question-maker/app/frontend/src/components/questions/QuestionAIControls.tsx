/**
 * AI configuration block: status badge, prompt, model, difficulty/reasoning, API key, Generate button.
 * For use in AddQuestionDialog right column (prototype-style layout).
 */
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '../ui/select';
import { EduAIStatusBadge } from '../eduai/EduAIStatusBadge';
import { apiKeyStorage } from '../../services/apiKeyStorage';
import type { EduAIModelOption } from '../../services/eduaiService';
import type { QuestionGenerationPhase } from '../../hooks/useEduAIStatus';

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
    providerApiKey: string;
    onProviderApiKeyChange: (value: string) => void;
    status: 'loading' | 'ok' | 'error';
    statusMessage?: string;
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
    status,
    statusMessage,
    onRefreshStatus,
    questionGenerationPhase,
    courseWarningMessage,
    mode,
    disabled = false
}: QuestionAIControlsProps) {
    const isExternal = availableModels.find((m) => m.id === value.generationModel)?.provider !== 'ollama';
    const requiresKey = apiKeyStorage.requiresApiKey(value.generationModel);
    const providerName = apiKeyStorage.getProviderFromModel(value.generationModel);

    return (
        <div className="rounded-lg border border-border bg-card p-5 space-y-4" data-tour-id="aq-eduai-panel">
            <div className="space-y-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    AI configuration
                </h2>
                <div className="flex items-center gap-2">
                    <EduAIStatusBadge
                        status={status}
                        message={statusMessage}
                        onRefresh={onRefreshStatus}
                        questionGenerationPhase={questionGenerationPhase}
                        className="z-50"
                    />
                </div>
            </div>

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
                    className="bg-secondary border-border resize-none text-sm min-h-16"
                    rows={3}
                />
            </div>

            {isExternal && (
                <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                    <span className="font-semibold">Warning:</span> External models send your prompts and course data to
                    that provider. UBC-hosted models keep data within UBC systems.
                </div>
            )}

            {requiresKey && providerName && (
                <div className="space-y-1.5">
                    <Label htmlFor="provider-api-key" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        {providerName.toUpperCase()} API Key
                    </Label>
                    {providerApiKey ? (
                        <div className="flex items-center gap-2">
                            <Input
                                id="provider-api-key"
                                type="text"
                                value={`${providerApiKey.substring(0, 8)}${'•'.repeat(Math.max(0, providerApiKey.length - 8))}`}
                                disabled
                                className="h-9 text-xs flex-1 bg-secondary border-border"
                            />
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                    apiKeyStorage.removeApiKey(providerName);
                                    onProviderApiKeyChange('');
                                }}
                            >
                                Change
                            </Button>
                        </div>
                    ) : (
                        <Input
                            id="provider-api-key"
                            type="password"
                            placeholder={`Enter your ${providerName.toUpperCase()} API key`}
                            value={providerApiKey}
                            className="h-9 text-xs bg-secondary border-border"
                            onChange={(e) => onProviderApiKeyChange(e.target.value)}
                        />
                    )}
                    <p className="text-[11px] text-muted-foreground">
                        Your API key is stored locally in your browser and never sent to our servers.
                    </p>
                </div>
            )}

            <Button
                type="button"
                onClick={onGenerate}
                disabled={disabled || isGenerating || !value.generationPrompt.trim()}
                className="w-full"
                size="sm"
                data-tour-id="aq-ai-generate"
            >
                {isGenerating ? 'Generating...' : 'Generate'}
            </Button>
        </div>
    );
}
