import { useChat } from "@ai-sdk/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, redirect, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { AdminChatView } from "~/components/chat/admin-chat-view";
import { CoreAppShell } from "~/components/layout/core-app-shell";
import type { ChatModelOption } from "~/components/chat/chat-view-types";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@eduai/ui";
import { fetchChatSession } from "~/hooks/api/use-chat-sessions";
import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";
import { useAssistiveUi } from "~/components/assistive/assistive-ui-provider";
import { logChatApiResponse, logChatUseChatError } from "~/lib/chat-client-log";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    return redirect("/auth/login");
  }

  if (session.user.role !== "ADMIN") {
    return redirect("/dashboard");
  }

  const dbModels = await prisma.aIModel.findMany({
    where: { isActive: true, supportsTools: true },
    include: { provider: true },
    orderBy: [{ provider: { name: "asc" } }, { name: "asc" }],
  });

  const chatModels: ChatModelOption[] = dbModels.map((model) => ({
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
    user: session.user,
  };
}

export default function AdminChatPage() {
  const { chatModels, user } = useLoaderData<typeof loader>();

  const [selectedModel, setSelectedModel] = useState(
    chatModels.length > 0 ? chatModels[0].id : "",
  );
  const [chatId, setChatId] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [adhdAssist, setAdhdAssist] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [webToolsEnabled] = useState(false);
  const [routedModelByMessageId, setRoutedModelByMessageId] = useState<
    Record<string, string>
  >({});
  const [streamingRoutedRegistryId, setStreamingRoutedRegistryId] = useState<
    string | null
  >(null);
  const pendingRoutedRegistryIdRef = useRef<string | null>(null);
  const { assistive, setAssistive } = useAssistiveUi();

  useEffect(() => {
    if (!chatId || systemPrompt) {
      return;
    }

    void (async () => {
      const session = await fetchChatSession(chatId);
      if (!session) {
        return;
      }
      if (session.systemPrompt) {
        setSystemPrompt(session.systemPrompt);
      }
      setAdhdAssist(Boolean(session.adhdAssist));
      setAssistive(Boolean(session.adhdAssist));
    })();
  }, [chatId, systemPrompt, setAssistive]);

  // Mirror Focus mode onto <html data-assistive-focus-mode> so the shared CSS
  // hides the sidebar/history rail, matching ChatScreen's behavior.
  useEffect(() => {
    const el = document.documentElement;
    if (focusMode) {
      el.setAttribute("data-assistive-focus-mode", "true");
    } else {
      el.removeAttribute("data-assistive-focus-mode");
    }
    return () => el.removeAttribute("data-assistive-focus-mode");
  }, [focusMode]);

  const handleAssistiveChange = useCallback(
    (checked: boolean) => {
      setAdhdAssist(checked);
      setAssistive(checked);
    },
    [setAssistive],
  );

  const requestMetadata = {
    chatMode: "admin" as const,
    model: selectedModel,
    chatId: chatId || undefined,
    systemPrompt: systemPrompt || undefined,
    adhdAssist,
  };

  const { messages, input, handleInputChange, handleSubmit, isLoading, stop } = useChat({
    api: "/api/chat",
    sendExtraMessageFields: true,
    body: requestMetadata,
    experimental_prepareRequestBody: ({ messages: chatMessages, requestBody }) => ({
      ...(requestBody ?? requestMetadata),
      chatMode: "admin",
      messages: chatMessages.slice(-1),
    }),
    onResponse: async (response) => {
      // Same X-Routed-Model wiring as learning ChatScreen so timed progress
      // estimates use the actual routed model (#1171).
      const routedHeader = response.headers.get("X-Routed-Model")?.trim();
      const routed =
        routedHeader && routedHeader.length > 0 ? routedHeader : null;
      pendingRoutedRegistryIdRef.current = routed;
      setStreamingRoutedRegistryId(routed);

      await logChatApiResponse(response, "admin-chat");
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
      logChatUseChatError(error, "admin-chat");
      // Clear routed-model latch on error so the next turn does not skip
      // Routing… or estimate against a dead model. Stop/abort is separate:
      // AI SDK v4 swallows AbortError and skips onError/onFinish.
      pendingRoutedRegistryIdRef.current = null;
      setStreamingRoutedRegistryId(null);
    },
  });

  // AI SDK v4 swallows AbortError from stop(), so onError/onFinish never run.
  // Clear the latch here or the next turn keeps the aborted turn's model.
  const handleStop = useCallback(() => {
    pendingRoutedRegistryIdRef.current = null;
    setStreamingRoutedRegistryId(null);
    stop();
  }, [stop]);

  const selectedModelInfo = chatModels.find((model) => model.id === selectedModel);

  const handleSystemPromptSave = async (prompt: string | null) => {
    setSystemPrompt(prompt);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatMode: "admin",
          chatId: chatId || undefined,
          systemPrompt: prompt,
          messages: messages.length > 0 ? messages : [],
          model: selectedModel,
          adhdAssist,
          streaming: false,
        }),
      });
      const data = await response.json();
      if (data.chatId && !chatId) {
        setChatId(data.chatId);
      }
    } catch (error) {
      console.error("Failed to save system prompt:", error);
    }
  };

  const handlePromptSelect = (prompt: string) => {
    const inputEvent = {
      target: { value: prompt },
      currentTarget: { value: prompt },
    } as React.ChangeEvent<HTMLInputElement>;

    handleInputChange(inputEvent);

    requestAnimationFrame(() => {
      const formEvent = {
        preventDefault: () => {},
        currentTarget: {} as HTMLFormElement,
      } as React.FormEvent<HTMLFormElement>;
      handleSubmit(formEvent);
    });
  };

  return (
    <CoreAppShell
      user={user}
      insetClassName="flex flex-col min-h-0"
      breadcrumbs={
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/dashboard">Home</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Admin Chatbot</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      }
    >
      <AdminChatView
        chatModels={chatModels}
        selectedModel={selectedModel}
        setSelectedModel={setSelectedModel}
        selectedModelInfo={selectedModelInfo}
        selectedCourseCode={null}
        setSelectedCourseCode={() => {}}
        availableCourses={[]}
        messages={messages}
        input={input}
        isLoading={isLoading}
        adhdAssist={adhdAssist}
        assistive={assistive}
        onAssistiveChange={handleAssistiveChange}
        focusMode={focusMode}
        onFocusModeChange={setFocusMode}
        webToolsEnabled={webToolsEnabled}
        systemPrompt={systemPrompt}
        onSystemPromptSave={handleSystemPromptSave}
        onInputChange={handleInputChange}
        onSubmit={handleSubmit}
        onStop={handleStop}
        onSelectPrompt={handlePromptSelect}
        routedModelByMessageId={routedModelByMessageId}
        streamingRoutedRegistryId={streamingRoutedRegistryId}
      />
    </CoreAppShell>
  );
}
