import { useChat } from "@ai-sdk/react";
import { useCallback, useEffect, useState } from "react";
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
import { useApiKeys } from "~/hooks/use-api-keys";
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

  const handleAssistiveChange = useCallback(
    (checked: boolean) => {
      setAdhdAssist(checked);
      if (!checked) setFocusMode(false);
      setAssistive(checked);
    },
    [setAssistive],
  );

  const { getValidApiKeys } = useApiKeys();

  const requestMetadata = {
    chatMode: "admin" as const,
    model: selectedModel,
    apiKeys: getValidApiKeys(),
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
      await logChatApiResponse(response, "admin-chat");
      const chatIdHeader = response.headers.get("X-Chat-Id");
      if (chatIdHeader && !chatId) {
        setChatId(chatIdHeader);
      }
    },
    onError: (error) => logChatUseChatError(error, "admin-chat"),
  });

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
          apiKeys: getValidApiKeys(),
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
        onStop={stop}
        onSelectPrompt={handlePromptSelect}
      />
    </CoreAppShell>
  );
}
