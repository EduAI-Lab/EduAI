import { useChat } from '@ai-sdk/react';
import { useState, useEffect, useCallback } from "react";
import { redirect, useLoaderData, useFetcher } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Select, SelectContent, SelectItem, SelectTrigger } from "~/components/ui/select";
import { ChatWelcome } from "~/components/chat/chat-welcome";
import { ChatMessage } from "~/components/chat/chat-message";
import { ChatInput } from "~/components/chat/chat-input";
import { ChatTypingIndicator } from "~/components/chat/chat-typing-indicator";
import { SystemPromptSettings } from "~/components/chat/system-prompt-settings";
import { Switch } from "~/components/ui/switch";
import { Label } from "~/components/ui/label";
import { useApiKeys } from "~/hooks/use-api-keys";
import { AppSidebar } from "~/components/app-sidebar";
import { SiteHeader } from "~/components/site-header";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";

import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";

interface ChatModel {
  id: string;
  name: string;
  description: string;
  provider: string;
  maxTokens?: number;
  supportsImages?: boolean;
  supportsTools?: boolean;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession(request);

  if (!session?.user) {
    return redirect("/auth/login");
  }

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
  const chatModels: ChatModel[] = dbModels.map((model: any) => ({
    id: `${model.provider.name}:${model.modelId}`,
    name: model.name,
    description: model.description,
    provider: model.provider.name,
    maxTokens: model.maxTokens || undefined,
    supportsImages: model.supportsImages,
    supportsTools: model.supportsTools,
  }));

  const preference = await prisma.userPreference.findUnique({
    where: { userId: session.user.id },
  });

  return {
    chatModels,
    user: session.user,
    assistDefault: preference?.assistDefault ?? false,
    lastCourseCode: preference?.lastCourseCode ?? null,
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

  const body = await request.json().catch(() => null);
  const payload = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  const data: { assistDefault?: boolean; lastCourseCode?: string | null } = {};
  if (typeof payload.assistDefault === "boolean") {
    data.assistDefault = payload.assistDefault;
  }
  if (typeof payload.lastCourseCode === "string") {
    const trimmed = payload.lastCourseCode.trim();
    data.lastCourseCode = trimmed.length > 0 ? trimmed : null;
  } else if (payload.lastCourseCode === null) {
    data.lastCourseCode = null;
  }

  if (Object.keys(data).length === 0) {
    return new Response(JSON.stringify({ error: "No valid preference fields provided" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const preference = await prisma.userPreference.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id, ...data },
    update: data,
  });

  return {
    assistDefault: preference.assistDefault,
    lastCourseCode: preference.lastCourseCode,
  };
}

export default function Chat() {
  const { chatModels, user, assistDefault, lastCourseCode } = useLoaderData<typeof loader>();
  const [selectedModel, setSelectedModel] = useState(chatModels.length > 0 ? chatModels[0].id : '');
  const [selectedCourseCode, setSelectedCourseCode] = useState<string | null>(lastCourseCode);
  const [availableCourses, setAvailableCourses] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [adhdAssist, setAdhdAssist] = useState(assistDefault);
  const { apiKeys, getValidApiKeys } = useApiKeys();
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

  // Fetch available courses
  useEffect(() => {
    const fetchCourses = async () => {
      try {
        const response = await fetch('/api/courses');
        const data = await response.json();
        const courses: Array<{ id: string; name: string; code: string }> = data.courses || [];
        setAvailableCourses(courses);
        setSelectedCourseCode((current) =>
          current && !courses.some((c) => c.code === current) ? null : current,
        );
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
  }, [chatId]);

  const { messages, input, handleInputChange, handleSubmit, isLoading, stop } = useChat({
    api: "/api/chat",
    body: {
      model: selectedModel,
      apiKeys: getValidApiKeys(),
      courseCode: selectedCourseCode || undefined,
      chatId: chatId || undefined,
      systemPrompt: systemPrompt || undefined,
      adhdAssist,
    },
    onResponse: async (response) => {
      // Extract chatId from response headers
      const chatIdHeader = response.headers.get('X-Chat-Id');
      if (chatIdHeader && !chatId) {
        setChatId(chatIdHeader);
      }
    },
    onFinish: async (message) => {
      // chatId is already captured from headers in onResponse
    },
  });

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
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" user={user} />
      <SidebarInset>
        <SiteHeader user={user} />
        <div className="flex flex-col h-[calc(100vh-var(--header-height))] bg-gradient-to-br from-background via-background to-muted/20">
          {/* Main content area */}
          <div className="flex-1 flex flex-col min-h-0 relative">
            <div className="h-full overflow-y-auto scrollbar-hover">
              <div className="px-4 py-6">
                <div className="max-w-4xl mx-auto space-y-6">
                  <div className="flex items-center justify-end gap-4">
                    <div className="flex items-center gap-2">
                      <Switch
                        id="adhd-assist"
                        checked={adhdAssist}
                        onCheckedChange={(checked) => handleAssistChange(Boolean(checked))}
                        aria-label="Assistive mode"
                      />
                      <Label htmlFor="adhd-assist" className="text-sm">
                        Assistive mode {adhdAssist ? "On" : "Off"}
                      </Label>
                    </div>
                    <SystemPromptSettings
                      systemPrompt={systemPrompt}
                      onSave={handleSystemPromptSave}
                    />
                  </div>

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
            selectedCourseId={selectedCourseCode}
            setSelectedCourseId={handleCourseChange}
            availableCourses={availableCourses}
            selectedModel={selectedModel}
            setSelectedModel={setSelectedModel}
            chatModels={chatModels}
            selectedModelInfo={selectedModelInfo}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
