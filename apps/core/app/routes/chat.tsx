import { useChat } from '@ai-sdk/react';
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { redirect, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
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
  type ChatModelOption,
  defaultChatModelId,
  withAutoChatModel,
} from "~/lib/chat-auto-model";
import { routerAutoDefaultEnabled } from "~/lib/router-env.server";

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

  return {
    chatModels,
    routerAutoEnabled,
    user: session.user
  };
}

export default function Chat() {
  const { chatModels, routerAutoEnabled, user } = useLoaderData<typeof loader>();
  const [selectedModel, setSelectedModel] = useState(() =>
    defaultChatModelId(chatModels, routerAutoEnabled),
  );
  const [selectedCourseCode, setSelectedCourseCode] = useState<string | null>(null);
  const [availableCourses, setAvailableCourses] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [adhdAssist, setAdhdAssist] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { apiKeys, getValidApiKeys, updateProviderSettings, removeProviderSettings, isProviderConfigured } = useApiKeys();

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
      // Extract chatId from response headers
      const chatIdHeader = response.headers.get('X-Chat-Id');
      if (chatIdHeader && !chatId) {
        setChatId(chatIdHeader);
      }
    },
    onError: (error) => {
      console.error("[chat] stream error", error);
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
        setAvailableCourses(data.courses || []);
      } catch (error) {
        console.error('Failed to fetch courses:', error);
      }
    };
    fetchCourses();
  }, []);

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
              onAdhdAssistChange={setAdhdAssist}
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

                        return (
                          <ChatMessage
                            key={message.id}
                            message={message}
                            isStreaming={isStreamingMessage}
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
            setSelectedCourseId={setSelectedCourseCode}
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
