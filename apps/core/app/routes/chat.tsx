import { useChat } from '@ai-sdk/react';
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { redirect, useLoaderData, useFetcher } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { ChatWelcome } from "~/components/chat/chat-welcome";
import { ChatMessage } from "~/components/chat/chat-message";
import { ChatInput } from "~/components/chat/chat-input";
import { ChatTypingIndicator } from "~/components/chat/chat-typing-indicator";
import { ChatHeaderControls } from "~/components/chat/chat-header-controls";
import { ApiKeySettings } from "~/components/chat/api-key-settings";
import { useApiKeys } from "~/hooks/use-api-keys";
import { AppSidebar } from "~/components/app-sidebar";
import { SiteHeader } from "~/components/site-header";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";

import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";
import {
  AUTO_MODEL_ID,
  type ChatModelOption,
  defaultChatModelId,
  displayNameForRegistryId,
  withAutoChatModel,
} from "~/lib/chat-auto-model";
import { routerAutoDefaultEnabled } from "~/lib/router-env.server";
import { getUserPreference, saveUserPreference } from "~/lib/user-preferences.server";
import { getAccessibleCourseCodes } from "~/lib/courses/server";
import { parsePreferenceUpdates, resolveSelectedCourse } from "~/lib/user-preferences";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession(request);

  if (!session?.user) {
    return redirect("/auth/login");
  }

  const routerAutoEnabled = routerAutoDefaultEnabled();

  // Fetch AI models from database
  const dbModels = await prisma.aIModel.findMany({
    where: { isActive: true },
    include: {
      provider: true,
    },
    orderBy: [
      { provider: { name: 'asc' } },
      { name: 'asc' }
    ]
  });

  // Transform database models to match our interface
  const registryModels: ChatModelOption[] = dbModels.map((model: any) => ({
    id: `${model.provider.name}:${model.modelId}`,
    name: model.name,
    description: model.description,
    provider: model.provider.name,
    maxTokens: model.maxTokens || undefined,
    supportsImages: model.supportsImages,
    supportsTools: model.supportsTools,
  }));

  const chatModels = withAutoChatModel(registryModels, routerAutoEnabled);

  // Validate the persisted course against the courses THIS user can actually
  // access, so a stale / now-inaccessible `lastCourseCode` is dropped on restore
  // rather than treated as valid just because the course still exists (#420 review).
  const availableCourseCodes = await getAccessibleCourseCodes(session.user);
  const preferences = await getUserPreference(session.user.id, availableCourseCodes);

  return {
    chatModels,
    routerAutoEnabled,
    user: session.user,
    ...preferences,
  };
}

/**
 * Persists the per-user chat preferences written from this route (Assistive-mode
 * default + last selected course). Accepts any subset of
 * { assistDefault?: boolean, lastCourseCode?: string | null }.
 */
export async function action({ request }: ActionFunctionArgs) {
  const session = await auth.api.getSession(request);
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const updates = parsePreferenceUpdates(await request.json().catch(() => null));
  if (Object.keys(updates).length === 0) {
    return new Response(JSON.stringify({ error: "No valid preference fields provided" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  return saveUserPreference(session.user.id, updates);
}

export default function Chat() {
  const { chatModels, routerAutoEnabled, user, assistDefault, lastCourseCode } =
    useLoaderData<typeof loader>();
  const [selectedModel, setSelectedModel] = useState(() =>
    defaultChatModelId(chatModels, routerAutoEnabled),
  );
  const [selectedCourseCode, setSelectedCourseCode] = useState<string | null>(lastCourseCode);
  const [availableCourses, setAvailableCourses] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [adhdAssist, setAdhdAssist] = useState(assistDefault);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Registry ids from `X-Routed-Model`, keyed by assistant message id after each turn. */
  const [routedModelByMessageId, setRoutedModelByMessageId] = useState<
    Record<string, string>
  >({});
  /** Latest streamed response registry id (shown on the in-flight assistant bubble). */
  const [streamingRoutedRegistryId, setStreamingRoutedRegistryId] = useState<
    string | null
  >(null);
  const pendingRoutedRegistryIdRef = useRef<string | null>(null);
  const { apiKeys, getValidApiKeys, updateProviderSettings, removeProviderSettings, isProviderConfigured } = useApiKeys();
  const prefsFetcher = useFetcher();

  const persistPreference = useCallback(
    (updates: { assistDefault?: boolean; lastCourseCode?: string | null }) => {
      prefsFetcher.submit(updates, {
        method: "post",
        encType: "application/json",
      });
    },
    [prefsFetcher],
  );

  const handleAssistChange = useCallback(
    (checked: boolean) => {
      setAdhdAssist(checked);
      persistPreference({ assistDefault: checked });
    },
    [persistPreference],
  );

  const handleCourseChange = useCallback(
    (code: string | null) => {
      setSelectedCourseCode(code);
      persistPreference({ lastCourseCode: code });
    },
    [persistPreference],
  );

  const chatOptsRef = useRef({
    selectedModel,
    selectedCourseCode,
    chatId,
    systemPrompt,
    adhdAssist,
    getValidApiKeys,
  });

  useEffect(() => {
    chatOptsRef.current = {
      selectedModel,
      selectedCourseCode,
      chatId,
      systemPrompt,
      adhdAssist,
      getValidApiKeys,
    };
  }, [selectedModel, selectedCourseCode, chatId, systemPrompt, adhdAssist, getValidApiKeys]);

  const buildChatRequestBody = useCallback(
    () => ({
      model: chatOptsRef.current.selectedModel,
      apiKeys: chatOptsRef.current.getValidApiKeys(),
      courseCode: chatOptsRef.current.selectedCourseCode || undefined,
      chatId: chatOptsRef.current.chatId || undefined,
      systemPrompt: chatOptsRef.current.systemPrompt || undefined,
      adhdAssist: chatOptsRef.current.adhdAssist,
    }),
    [],
  );

  const chatBody = useMemo(
    () => buildChatRequestBody(),
    [buildChatRequestBody, selectedModel, selectedCourseCode, chatId, systemPrompt, adhdAssist, apiKeys],
  );

  const { messages, input, handleInputChange, handleSubmit: useChatHandleSubmit, isLoading, stop } = useChat({
    api: "/api/chat",
    body: chatBody,
    experimental_prepareRequestBody: ({ id, messages, requestData, requestBody }) => ({
      id,
      messages,
      data: requestData,
      ...buildChatRequestBody(),
      ...requestBody,
    }),
    onResponse: async (response) => {
      if (!response.ok) {
        const text = await response.clone().text().catch(() => "");
        console.error("[chat] request failed", response.status, text);
      }

      const routedHeader = response.headers.get("X-Routed-Model")?.trim();
      const routed =
        routedHeader && routedHeader.length > 0 ? routedHeader : null;
      pendingRoutedRegistryIdRef.current = routed;
      setStreamingRoutedRegistryId(routed);

      const chatIdHeader = response.headers.get("X-Chat-Id");
      if (chatIdHeader && !chatId) {
        setChatId(chatIdHeader);
      }
    },
    onFinish: (message) => {
      const routed = pendingRoutedRegistryIdRef.current;
      if (message.role === "assistant" && routed) {
        setRoutedModelByMessageId((prev) => ({ ...prev, [message.id]: routed }));
      }
      pendingRoutedRegistryIdRef.current = null;
      setStreamingRoutedRegistryId(null);
    },
    onError: (error) => {
      console.error("[chat] stream error", error);
      pendingRoutedRegistryIdRef.current = null;
      setStreamingRoutedRegistryId(null);
    },
  });

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      useChatHandleSubmit(event, { body: buildChatRequestBody() });
    },
    [useChatHandleSubmit, buildChatRequestBody],
  );

  // Fetch available courses
  useEffect(() => {
    const fetchCourses = async () => {
      try {
        const response = await fetch('/api/courses');
        const data = await response.json();
        const courses: Array<{ id: string; name: string; code: string }> = data.courses || [];
        const courseCodes = courses.map((c) => c.code);
        setAvailableCourses(courses);
        setSelectedCourseCode((current) => {
          const resolved = resolveSelectedCourse(current, courseCodes);
          if (current && resolved === null) {
            persistPreference({ lastCourseCode: null });
          }
          return resolved;
        });
      } catch (error) {
        console.error('Failed to fetch courses:', error);
      }
    };
    fetchCourses();
  }, [persistPreference]);

  // Load system prompt when chatId is set
  useEffect(() => {
    if (chatId && !systemPrompt) {
      fetch(`/api/chats/${chatId}`)
        .then(res => res.json())
        .then(data => {
          if (data.systemPrompt) {
            setSystemPrompt(data.systemPrompt);
          }
          setAdhdAssist(Boolean(data.adhdAssist));
        })
        .catch(console.error);
    }
  }, [chatId, systemPrompt]);

  const selectedModelInfo = chatModels.find((model: any) => model.id === selectedModel);

  const handleSystemPromptSave = async (prompt: string | null) => {
    setSystemPrompt(prompt);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId: chatId || undefined,
          systemPrompt: prompt,
          messages: messages.length > 0 ? messages : [],
          model: selectedModel,
          apiKeys: getValidApiKeys(),
          courseCode: selectedCourseCode || undefined,
          adhdAssist,
          streaming: false,
        }),
      });
      const data = await response.json();
      if (data.chatId && !chatId) {
        setChatId(data.chatId);
      }
    } catch (error) {
      console.error('Failed to save system prompt:', error);
    }
  };

  const handlePromptSelect = (prompt: string) => {
    // Create proper synthetic events
    const inputEvent = {
      target: { value: prompt },
      currentTarget: { value: prompt }
    } as React.ChangeEvent<HTMLInputElement>;

    handleInputChange(inputEvent);

    // Use requestAnimationFrame for better timing
    requestAnimationFrame(() => {
      const formEvent = {
        preventDefault: () => {},
        currentTarget: {} as HTMLFormElement
      } as React.FormEvent<HTMLFormElement>;
      handleSubmit(formEvent);
    });
  };

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 14)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" user={user} />
      <SidebarInset>
        <SiteHeader
          title="Chat"
          actions={
            <ChatHeaderControls
              adhdAssist={adhdAssist}
              onAdhdAssistChange={handleAssistChange}
              systemPrompt={systemPrompt}
              onSystemPromptSave={handleSystemPromptSave}
            />
          }
        />
        <div className="flex flex-col h-[calc(100vh-var(--header-height))] bg-gradient-to-br from-background via-background to-muted/20">
          {/* Main content area */}
          <div className="flex-1 flex flex-col min-h-0 relative">
            <div className="h-full overflow-y-auto scrollbar-hover">
              <div className="px-4 py-6">
                <div className="max-w-4xl mx-auto space-y-6">
                  {messages.length === 0 ? (
                    <ChatWelcome
                      selectedModelInfo={selectedModelInfo}
                      onSelectPrompt={handlePromptSelect}
                    />
                  ) : (
                    <>
                      {messages.map((message, index) => {
                        const isLastMessage = index === messages.length - 1;
                        const isStreamingMessage = isLastMessage && isLoading;

                        const routedRegistryId =
                          message.role === "assistant"
                            ? (routedModelByMessageId[message.id] ??
                              (isStreamingMessage ? streamingRoutedRegistryId : null))
                            : null;
                        const answeredByLabel =
                          selectedModel === AUTO_MODEL_ID && routedRegistryId
                            ? displayNameForRegistryId(routedRegistryId, chatModels)
                            : undefined;

                        return (
                          <ChatMessage
                            key={message.id}
                            message={message}
                            isStreaming={isStreamingMessage}
                            answeredByLabel={answeredByLabel}
                          />
                        );
                      })}

                      {isLoading && <ChatTypingIndicator />}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Sticky input at bottom with integrated selectors */}
          <ChatInput
            input={input}
            isLoading={isLoading}
            onInputChange={handleInputChange}
            onSubmit={handleSubmit}
            onStop={stop}
            onOpenSettings={() => setSettingsOpen(true)}
            selectedCourseId={selectedCourseCode}
            setSelectedCourseId={handleCourseChange}
            availableCourses={availableCourses}
            selectedModel={selectedModel}
            setSelectedModel={setSelectedModel}
            chatModels={chatModels}
            selectedModelInfo={selectedModelInfo}
          />
          <ApiKeySettings
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            apiKeys={apiKeys}
            isProviderConfigured={isProviderConfigured}
            onUpdateProvider={updateProviderSettings}
            onRemoveProvider={removeProviderSettings}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
