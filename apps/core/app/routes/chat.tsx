import { useChat } from '@ai-sdk/react';
import { useState, useEffect, useCallback } from "react";
import { redirect, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import type { Message } from "ai";
import { Select, SelectContent, SelectItem, SelectTrigger } from "~/components/ui/select";
import { ChatWelcome } from "~/components/chat/chat-welcome";
import { ChatMessage } from "~/components/chat/chat-message";
import { ChatInput } from "~/components/chat/chat-input";
import { ChatTypingIndicator, type TypingPhase } from "~/components/chat/chat-typing-indicator";
import { SystemPromptSettings } from "~/components/chat/system-prompt-settings";
import { useApiKeys } from "~/hooks/use-api-keys";
import { AppSidebar } from "~/components/app-sidebar";
import { SiteHeader } from "~/components/site-header";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";

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

type InflightStatus =
  | { phase: TypingPhase; toolName?: string; toolInput?: unknown }
  | null;

/**
 * Mirror of `@ai-sdk/ui-utils` `getMessageParts`: during streaming, `useChat`
 * sometimes updates the assistant row before `parts` is populated, leaving only
 * `toolInvocations` / `content`. Without this, `getInflightStatus` never sees
 * tool calls and the typing line stays stuck on "EduAI is thinking".
 */
function getEffectiveParts(message: Message): Array<Record<string, unknown>> {
  const m = message as Message & {
    parts?: Array<Record<string, unknown>>;
    toolInvocations?: Array<Record<string, unknown>>;
  };
  if (m.parts && m.parts.length > 0) {
    return m.parts;
  }
  const out: Array<Record<string, unknown>> = [];
  if (Array.isArray(m.toolInvocations)) {
    for (const inv of m.toolInvocations) {
      out.push({ type: "tool-invocation", toolInvocation: inv });
    }
  }
  const content = typeof message.content === "string" ? message.content : "";
  if (content) {
    out.push({ type: "text", text: content });
  }
  return out;
}

/**
 * Inspect the last message in the chat to figure out what phase the assistant
 * is currently in, so the typing indicator can show meaningful progress instead
 * of a static "thinking..." for the whole tool-call window.
 *
 * Returns `null` when nothing should be shown (request is idle, or visible
 * text has already started streaming so the bubble itself is the signal).
 */
function getInflightStatus(messages: Message[], isLoading: boolean): InflightStatus {
  if (!isLoading) return null;

  const lastMessage = messages[messages.length - 1];
  if (!lastMessage || lastMessage.role !== "assistant") {
    return { phase: "thinking" };
  }

  const parts = getEffectiveParts(lastMessage);

  const hasVisibleText = parts.some(
    (p) => p.type === "text" && typeof p.text === "string" && p.text.length > 0,
  );
  if (hasVisibleText) return null;

  const toolParts = parts.filter(
    (p) => p.type === "tool-invocation" || (typeof p.type === "string" && p.type.startsWith("tool-")),
  );

  const inProgressStates = new Set([
    "input-streaming",
    "input-available",
    "partial-call",
    "call",
  ]);

  const activeTool = [...toolParts].reverse().find((p) => {
    const state = (p as { toolInvocation?: { state?: string }; state?: string }).toolInvocation
      ?.state ?? (p as { state?: string }).state;
    return state && inProgressStates.has(state);
  });

  if (activeTool) {
    const at = activeTool as {
      toolInvocation?: { toolName?: string; args?: unknown };
      toolName?: string;
      type?: string;
      input?: unknown;
    };
    const toolName: string | undefined =
      at.toolInvocation?.toolName ??
      at.toolName ??
      (typeof at.type === "string" ? at.type.replace(/^tool-/, "") : undefined);
    const toolInput: unknown = at.toolInvocation?.args ?? at.input;
    return { phase: "tool", toolName, toolInput };
  }

  if (toolParts.length > 0) {
    return { phase: "writing" };
  }

  return { phase: "thinking" };
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

  return {
    chatModels,
    user: session.user
  };
}

export default function Chat() {
  const { chatModels, user } = useLoaderData<typeof loader>();
  const [selectedModel, setSelectedModel] = useState(chatModels.length > 0 ? chatModels[0].id : '');
  const [selectedCourseCode, setSelectedCourseCode] = useState<string | null>(null);
  const [availableCourses, setAvailableCourses] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const { apiKeys, getValidApiKeys } = useApiKeys();

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
        })
        .catch(console.error);
    }
  }, [chatId]);

  const [chatError, setChatError] = useState<string | null>(null);

  const { messages, input, handleInputChange, handleSubmit, isLoading, stop, error } = useChat({
    api: "/api/chat",
    body: {
      model: selectedModel,
      apiKeys: getValidApiKeys(),
      courseCode: selectedCourseCode || undefined,
      chatId: chatId || undefined,
      systemPrompt: systemPrompt || undefined,
    },
    onResponse: async (response) => {
      setChatError(null);
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        setChatError(
          text || `Request failed (${response.status}). Check the Network tab for the /api/chat response.`,
        );
      }
      const chatIdHeader = response.headers.get('X-Chat-Id');
      if (chatIdHeader && !chatId) {
        setChatId(chatIdHeader);
      }
    },
    onFinish: async () => {
      setChatError(null);
    },
    onError: (err) => {
      console.error("Chat stream error:", err);
      setChatError(err.message || "Something went wrong while streaming the reply.");
    },
  });

  const displayError = chatError ?? error?.message ?? null;

  const guardedSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      if (isLoading) return;
      handleSubmit(e);
    },
    [handleSubmit, isLoading],
  );

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
      guardedSubmit(formEvent);
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
                  <div className="flex justify-end">
                    <SystemPromptSettings
                      systemPrompt={systemPrompt}
                      onSave={handleSystemPromptSave}
                    />
                  </div>

                  {displayError && !isLoading && (
                    <Alert variant="destructive" className="mb-4">
                      <AlertTitle>Couldn&apos;t complete the reply</AlertTitle>
                      <AlertDescription className="space-y-2">
                        <p>{displayError}</p>
                        <p className="text-xs opacity-90">
                          If the model stopped mid-thread, the last request may have hit a provider
                          limit or returned a non-200. Open DevTools → Network → select the failed{" "}
                          <code className="rounded bg-muted px-1">chat</code> request and read the
                          response body.
                        </p>
                      </AlertDescription>
                    </Alert>
                  )}

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

                      {(() => {
                        const status = getInflightStatus(messages, isLoading);
                        if (!status) return null;
                        return (
                          <ChatTypingIndicator
                            phase={status.phase}
                            toolName={status.toolName}
                            toolInput={status.toolInput}
                          />
                        );
                      })()}
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
            onSubmit={guardedSubmit}
            onStop={stop}
            selectedCourseId={selectedCourseCode}
            setSelectedCourseId={setSelectedCourseCode}
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
