import { useCallback, useEffect, useMemo, useState } from 'react';
import { Spinner } from '@eduai/ui';
import {
    IconAccessible,
    IconCheck,
    IconLink,
    IconLoader2,
    IconLogout,
    IconTrash,
    IconUser,
    IconWorld,
} from '@tabler/icons-react';
import {
    AccessibilitySettings,
    Avatar,
    Badge,
    Button,
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    Checkbox,
    Input,
    Label,
    SettingsPageScaffold,
    SignOutCard,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    useTheme,
} from '@eduai/ui';
import apiKeyStorage, { type AIProvider } from '../services/apiKeyStorage';
import { eduaiService, type EduAIModelOption } from '../services/eduaiService';
import { canvasService, type CanvasIntegration } from '../services/canvasService';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'sonner';

// ── Constants ──────────────────────────────────────────────────────────────

const KEY_PROVIDERS: AIProvider[] = ['google', 'openai', 'deepseek', 'anthropic'];

const PROVIDER_LABELS: Record<AIProvider, string> = {
    google: 'Google AI (Gemini)',
    openai: 'OpenAI',
    deepseek: 'DeepSeek',
    anthropic: 'Anthropic',
};

const PROVIDER_PLACEHOLDERS: Record<AIProvider, string> = {
    google: 'AIza-...',
    openai: 'sk-...',
    deepseek: 'sk-...',
    anthropic: 'sk-ant-...',
};

const DEFAULT_MODEL_KEY = 'qm:default-model';
const EXPORT_PREFS_KEY = 'qm:export-prefs';

// ── Types ──────────────────────────────────────────────────────────────────

interface ExportPrefs {
    includeAnswerKey: boolean;
    includeAiTag: boolean;
}

const DEFAULT_EXPORT_PREFS: ExportPrefs = {
    includeAnswerKey: true,
    includeAiTag: false,
};

// ── Helpers ────────────────────────────────────────────────────────────────

/** Masks a stored key the way QuestionAIControls does: first 8 chars + bullets. */
function maskKey(value: string): string {
    return `${value.substring(0, 8)}${'•'.repeat(Math.max(0, value.length - 8))}`;
}

function readExportPrefs(): ExportPrefs {
    try {
        const raw = localStorage.getItem(EXPORT_PREFS_KEY);
        if (!raw) return DEFAULT_EXPORT_PREFS;
        const parsed = JSON.parse(raw) as Partial<ExportPrefs>;
        return {
            includeAnswerKey: parsed.includeAnswerKey ?? DEFAULT_EXPORT_PREFS.includeAnswerKey,
            includeAiTag: parsed.includeAiTag ?? DEFAULT_EXPORT_PREFS.includeAiTag,
        };
    } catch {
        return DEFAULT_EXPORT_PREFS;
    }
}

const CANVAS_DEFAULT_URL = import.meta.env.DEV ? 'http://localhost:8080' : 'https://canvas.ubc.ca';

// ── Component ──────────────────────────────────────────────────────────────

export default function SettingsPage() {
    const { user, logout } = useAuth();

    // ── Theme (from @eduai/ui ThemeProvider, shared `theme` localStorage key) ──
    const { theme: nextTheme, setTheme: setNextTheme } = useTheme();
    const theme = (nextTheme as 'system' | 'light' | 'dark' | undefined) ?? 'system';

    // QM has no per-account preference API; we just update next-themes localStorage.
    // Motion-reduced and density are not persisted in QM (no backend), so we keep
    // them as local state that applies for the session and mirrors the CSS attributes.
    const [motionReduced, setMotionReducedState] = useState(() => {
        return document.documentElement.hasAttribute('data-reduce-motion');
    });
    const [density, setDensityState] = useState<'comfortable' | 'compact'>(() => {
        return document.documentElement.getAttribute('data-density') === 'compact'
            ? 'compact'
            : 'comfortable';
    });

    const handleMotionReducedChange = (value: boolean) => {
        setMotionReducedState(value);
        if (value) {
            document.documentElement.setAttribute('data-reduce-motion', 'true');
        } else {
            document.documentElement.removeAttribute('data-reduce-motion');
        }
    };

    const handleDensityChange = (value: 'comfortable' | 'compact') => {
        setDensityState(value);
        if (value === 'compact') {
            document.documentElement.setAttribute('data-density', 'compact');
        } else {
            document.documentElement.removeAttribute('data-density');
        }
    };

    // ── Providers / API keys ───────────────────────────────────────────────
    const [storedKeys, setStoredKeys] = useState<Record<string, string>>({});
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [savingProvider, setSavingProvider] = useState<AIProvider | null>(null);

    const [models, setModels] = useState<EduAIModelOption[]>([]);
    const [defaultModel, setDefaultModel] = useState<string>(
        () => localStorage.getItem(DEFAULT_MODEL_KEY) ?? ''
    );

    const [exportPrefs, setExportPrefs] = useState<ExportPrefs>(() => readExportPrefs());

    const refreshKeys = async (): Promise<void> => {
        const keys = await apiKeyStorage.getAllApiKeys();
        setStoredKeys(keys);
    };

    useEffect(() => {
        void refreshKeys();
    }, []);

    useEffect(() => {
        let active = true;
        void eduaiService.listModels().then((result) => {
            if (active) setModels(result);
        });
        return () => {
            active = false;
        };
    }, []);

    const handleSaveKey = async (provider: AIProvider): Promise<void> => {
        const draft = (drafts[provider] ?? '').trim();
        if (!draft) return;
        setSavingProvider(provider);
        await apiKeyStorage.setApiKey(provider, draft);
        await refreshKeys();
        setDrafts((prev) => ({ ...prev, [provider]: '' }));
        setSavingProvider(null);
        toast(`${PROVIDER_LABELS[provider]} API key saved`);
    };

    const handleRemoveKey = async (provider: AIProvider): Promise<void> => {
        apiKeyStorage.removeApiKey(provider);
        await refreshKeys();
        toast(`${PROVIDER_LABELS[provider]} API key removed`);
    };

    const handleDefaultModelChange = (value: string): void => {
        setDefaultModel(value);
        localStorage.setItem(DEFAULT_MODEL_KEY, value);
        toast('Default model updated');
    };

    const handleExportPrefChange = (key: keyof ExportPrefs, checked: boolean): void => {
        const next = { ...exportPrefs, [key]: checked };
        setExportPrefs(next);
        localStorage.setItem(EXPORT_PREFS_KEY, JSON.stringify(next));
    };

    const hasModels = useMemo(() => models.length > 0, [models]);

    // ── Canvas integration ──────────────────────────────────────────────────
    const [canvasIntegration, setCanvasIntegration] = useState<CanvasIntegration | null>(null);
    const [canvasLoading, setCanvasLoading] = useState(true);
    const [canvasConnecting, setCanvasConnecting] = useState(false);
    const [canvasDisconnecting, setCanvasDisconnecting] = useState(false);
    const [canvasUrl, setCanvasUrl] = useState<string>(CANVAS_DEFAULT_URL);
    const [canvasApiKey, setCanvasApiKey] = useState('');
    const [canvasTestMode, setCanvasTestMode] = useState<boolean>(() =>
        canvasService.prefersTestMode()
    );

    const loadCanvasIntegration = useCallback(async () => {
        setCanvasLoading(true);
        const integration = await canvasService.getIntegration();
        setCanvasIntegration(integration);
        setCanvasLoading(false);
    }, []);

    useEffect(() => {
        void loadCanvasIntegration();
    }, [loadCanvasIntegration]);

    const handleCanvasConnect = async (): Promise<void> => {
        setCanvasConnecting(true);
        try {
            const { integration, usedTestMode } = await canvasService.connectCanvasWithFallback(
                canvasUrl.trim(),
                canvasApiKey.trim(),
                { preferTestMode: canvasTestMode }
            );
            setCanvasIntegration(integration);
            setCanvasApiKey('');
            toast(usedTestMode ? 'Canvas test mode enabled' : 'Canvas connected', {
                description: usedTestMode
                    ? 'Connected in test mode — no real Canvas token required.'
                    : 'Your API key is stored encrypted on the server and not shown again.',
            });
        } catch (error) {
            console.error('Failed to connect Canvas:', error);
            toast.error('Failed to connect Canvas', {
                description: error instanceof Error ? error.message : 'Check the URL and API key.',
            });
        } finally {
            setCanvasConnecting(false);
        }
    };

    const handleCanvasDisconnect = async (): Promise<void> => {
        setCanvasDisconnecting(true);
        try {
            await canvasService.disconnectCanvas();
            setCanvasIntegration(null);
            setCanvasApiKey('');
            toast('Canvas disconnected');
        } catch (error) {
            console.error('Failed to disconnect Canvas:', error);
            toast.error('Failed to disconnect Canvas');
        } finally {
            setCanvasDisconnecting(false);
        }
    };

    const canConnectCanvas =
        canvasUrl.trim().length > 0 &&
        (canvasTestMode || canvasApiKey.trim().length > 0) &&
        !canvasConnecting;

    return (
        <SettingsPageScaffold
            padding="qm"
            subheading="Manage your AI provider keys, Canvas connection, and accessibility preferences."
            defaultTab="providers"
            footer={
                <SignOutCard
                    action={
                        <Button type="button" variant="outline" onClick={() => void logout()}>
                            <IconLogout className="size-4" />
                            Log out
                        </Button>
                    }
                />
            }
            tabs={[
                {
                    value: 'providers',
                    label: 'Providers',
                    icon: <IconWorld className="h-4 w-4" />,
                    content: (
                        <>
                            {/* API Keys card — matches Core's Model Providers card structure */}
                            <Card>
                                <CardHeader>
                                    <CardTitle>Model Providers</CardTitle>
                                    <CardDescription>
                                        Browser-encrypted API keys used when generating questions with AI.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-6">
                                    {KEY_PROVIDERS.map((provider) => {
                                        const existing = storedKeys[provider];
                                        const isSaving = savingProvider === provider;
                                        return (
                                            <div key={provider} className="space-y-2">
                                                <Label className="mb-1">{PROVIDER_LABELS[provider]}</Label>
                                                {existing ? (
                                                    <div className="flex items-center gap-2">
                                                        <Badge variant="secondary">
                                                            Configured ({maskKey(existing)})
                                                        </Badge>
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => void handleRemoveKey(provider)}
                                                            className="text-destructive hover:text-destructive/80"
                                                        >
                                                            <IconTrash className="size-4" />
                                                            Remove
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-2">
                                                        <Input
                                                            type="password"
                                                            placeholder={PROVIDER_PLACEHOLDERS[provider]}
                                                            value={drafts[provider] ?? ''}
                                                            onChange={(e) =>
                                                                setDrafts((prev) => ({
                                                                    ...prev,
                                                                    [provider]: e.target.value,
                                                                }))
                                                            }
                                                            className="flex-1"
                                                        />
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            onClick={() => void handleSaveKey(provider)}
                                                            disabled={
                                                                isSaving ||
                                                                !(drafts[provider] ?? '').trim()
                                                            }
                                                        >
                                                            {isSaving ? 'Saving…' : 'Save'}
                                                        </Button>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </CardContent>
                            </Card>

                            {/* Default model card */}
                            <Card>
                                <CardHeader>
                                    <CardTitle>Default model</CardTitle>
                                    <CardDescription>
                                        Pre-selects the AI model used when generating questions.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    {hasModels ? (
                                        <Select
                                            value={defaultModel}
                                            onValueChange={handleDefaultModelChange}
                                        >
                                            <SelectTrigger className="w-full md:w-96">
                                                <SelectValue placeholder="Select a default model" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {models.map((model) => (
                                                    <SelectItem key={model.id} value={model.id}>
                                                        {model.label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    ) : (
                                        <p className="text-sm text-muted-foreground">
                                            No models available — configure a provider API key above.
                                        </p>
                                    )}
                                </CardContent>
                            </Card>

                            {/* Export preferences card */}
                            <Card>
                                <CardHeader>
                                    <CardTitle>Export preferences</CardTitle>
                                    <CardDescription>
                                        Control what is included when exporting question sets.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <label className="flex items-center gap-3 text-sm">
                                        <Checkbox
                                            checked={exportPrefs.includeAnswerKey}
                                            onCheckedChange={(checked) =>
                                                handleExportPrefChange(
                                                    'includeAnswerKey',
                                                    checked === true,
                                                )
                                            }
                                        />
                                        Include answer key in exports
                                    </label>
                                    <label className="flex items-center gap-3 text-sm">
                                        <Checkbox
                                            checked={exportPrefs.includeAiTag}
                                            onCheckedChange={(checked) =>
                                                handleExportPrefChange(
                                                    'includeAiTag',
                                                    checked === true,
                                                )
                                            }
                                        />
                                        Include AI-generated tag
                                    </label>
                                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                        <IconCheck className="size-3.5" />
                                        Preferences are saved locally as you change them.
                                    </p>
                                </CardContent>
                            </Card>

                        </>
                    ),
                },
                {
                    value: 'canvas',
                    label: 'Canvas',
                    icon: <IconLink className="h-4 w-4" />,
                    content: (
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <IconLink className="size-5" />
                                    Canvas Integration
                                </CardTitle>
                                <CardDescription>
                                    Connect your Canvas personal access token so Question Maker can
                                    export assessments and import quizzes. The token is encrypted on the
                                    server and never returned to the browser after saving.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-5">
                                {canvasLoading ? (
                                    <div className="flex items-center justify-center py-6">
                                        <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
                                    </div>
                                ) : (
                                    <>
                                        {canvasIntegration?.isConnected && (
                                            <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                                                <div className="min-w-0 space-y-1">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <Badge variant="secondary">Connected</Badge>
                                                        {canvasIntegration.isTestMode && (
                                                            <Badge variant="outline">Test mode</Badge>
                                                        )}
                                                    </div>
                                                    <p className="break-all font-mono text-sm">
                                                        {canvasIntegration.canvasUrl}
                                                    </p>
                                                </div>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => void handleCanvasDisconnect()}
                                                    disabled={canvasDisconnecting}
                                                    aria-label="Disconnect Canvas"
                                                    className="shrink-0 text-destructive hover:text-destructive/80"
                                                >
                                                    {canvasDisconnecting ? (
                                                        <Spinner />
                                                    ) : (
                                                        <IconTrash className="size-4" />
                                                    )}
                                                </Button>
                                            </div>
                                        )}

                                        <div className="space-y-2">
                                            <Label htmlFor="canvas-url">Canvas URL</Label>
                                            <Input
                                                id="canvas-url"
                                                value={canvasUrl}
                                                onChange={(e) => setCanvasUrl(e.target.value)}
                                                placeholder="https://canvas.ubc.ca"
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            <Label htmlFor="canvas-token">Canvas API token</Label>
                                            <Input
                                                id="canvas-token"
                                                type="password"
                                                value={canvasApiKey}
                                                onChange={(e) => setCanvasApiKey(e.target.value)}
                                                placeholder={canvasTestMode ? 'Not required in test mode' : '••••••••'}
                                                disabled={canvasTestMode}
                                            />
                                            <p className="text-xs text-muted-foreground">
                                                Create under Canvas → Settings → Approved Integrations →
                                                New Access Token.
                                            </p>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <Checkbox
                                                id="canvas-test-mode"
                                                checked={canvasTestMode}
                                                onCheckedChange={(checked) =>
                                                    setCanvasTestMode(checked === true)
                                                }
                                            />
                                            <Label
                                                htmlFor="canvas-test-mode"
                                                className="cursor-pointer font-normal"
                                            >
                                                Test mode (no real Canvas token required)
                                            </Label>
                                        </div>

                                        <Button
                                            onClick={() => void handleCanvasConnect()}
                                            disabled={!canConnectCanvas}
                                        >
                                            {canvasConnecting ? (
                                                <>
                                                    <Spinner />
                                                    Connecting…
                                                </>
                                            ) : canvasIntegration?.isConnected ? (
                                                'Update connection'
                                            ) : (
                                                'Connect Canvas'
                                            )}
                                        </Button>
                                    </>
                                )}
                            </CardContent>
                        </Card>
                    ),
                },
                {
                    value: 'accessibility',
                    label: 'Accessibility',
                    icon: <IconAccessible className="h-4 w-4" />,
                    content: (
                        <AccessibilitySettings
                            theme={theme}
                            density={density}
                            motionReduced={motionReduced}
                            onThemeChange={(value) => setNextTheme(value)}
                            onDensityChange={handleDensityChange}
                            onMotionReducedChange={handleMotionReducedChange}
                            description="Personalize how EduAI looks and feels. Theme choice is shared across all EduAI apps."
                        />
                    ),
                },
            ]}
        />
    );
}
