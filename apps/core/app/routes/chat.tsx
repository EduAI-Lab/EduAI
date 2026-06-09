import { useChat } from "@ai-sdk/react";
import { useEffect, useState } from "react";
import { redirect, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { AppSidebar } from "~/components/app-sidebar";
import { ChatCourseScopedView } from "~/components/chat/chat-course-scoped-view";
import { ChatGlobalView } from "~/components/chat/chat-global-view";
import type {
  ChatCourseOption,
  ChatModelOption,
} from "~/components/chat/chat-view-types";
import { SiteHeader } from "~/components/site-header";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";
import { fetchChatSession } from "~/hooks/api/use-chat-sessions";
import { useCourses } from "~/hooks/api/use-courses";
import { useApiKeys } from "~/hooks/use-api-keys";
import { auth } from "~/lib/auth/server";
import { usesGlobalChat } from "~/lib/rbac";
import prisma from "~/lib/prisma.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession(request);

  if (!session?.user) {
    return redirect("/auth/login");
  }

  const dbModels = await prisma.aIModel.findMany({
    where: { isActive: true },
    include: {
      provider: true,
    },
    orderBy: [
      { provider: { name: "asc" } },
      { name: "asc" },
    ],
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

export default function Chat() {
  const { chatModels, user } = useLoaderData<typeof loader>();
  const isGlobalChat = usesGlobalChat(user);
  const { courses } = useCourses();
  const availableCourses: ChatCourseOption[] = isGlobalChat
    ? []
    : courses.map((c) => ({ id: c.id, name: c.name, code: c.code }));
  const [selectedModel, setSelectedModel] = useState(
    chatModels.length > 0 ? chatModels[0].id : "",
  );
  const [selectedCourseCode, setSelectedCourseCode] = useState<string | null>(
    null,
  );
  const [chatId, setChatId] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [adhdAssist, setAdhdAssist] = useState(false);
  const { getValidApiKeys } = useApiKeys();

  useEffect(() => {
    if (isGlobalChat) setSelectedCourseCode(null);
  }, [isGlobalChat]);

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
    })();
  }, [chatId, systemPrompt]);

  const { messages, input, handleInputChange, handleSubmit, isLoading, stop } =
    useChat({
      api: "/api/chat",
      body: {
        model: selectedModel,
        apiKeys: getValidApiKeys(),
        courseCode: isGlobalChat ? undefined : selectedCourseCode || undefined,
        chatId: chatId || undefined,
        systemPrompt: systemPrompt || undefined,
        adhdAssist,
      },
      onResponse: async (response) => {
        const chatIdHeader = response.headers.get("X-Chat-Id");
        if (chatIdHeader && !chatId) {
          setChatId(chatIdHeader);
        }
      },
    });

  const selectedModelInfo = chatModels.find(
    (model) => model.id === selectedModel,
  );

  const handleSystemPromptSave = async (prompt: string | null) => {
    setSystemPrompt(prompt);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: chatId || undefined,
          systemPrompt: prompt,
          messages: messages.length > 0 ? messages : [],
          model: selectedModel,
          apiKeys: getValidApiKeys(),
          courseCode: isGlobalChat ? undefined : selectedCourseCode || undefined,
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

  const sharedViewProps = {
    chatModels,
    selectedModel,
    setSelectedModel,
    selectedModelInfo,
    selectedCourseCode,
    setSelectedCourseCode,
    availableCourses,
    messages,
    input,
    isLoading,
    adhdAssist,
    setAdhdAssist,
    systemPrompt,
    onSystemPromptSave: handleSystemPromptSave,
    onInputChange: handleInputChange,
    onSubmit: handleSubmit,
    onStop: stop,
    onSelectPrompt: handlePromptSelect,
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
        {isGlobalChat ? (
          <ChatGlobalView {...sharedViewProps} />
        ) : (
          <ChatCourseScopedView {...sharedViewProps} />
        )}
      </SidebarInset>
    </SidebarProvider>
  );
}
