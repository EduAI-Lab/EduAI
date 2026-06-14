import { useChat } from "@ai-sdk/react";
import { useCallback, useEffect, useState } from "react";
import { Link, redirect, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { AdminChatView } from "~/components/chat/admin-chat-view";
import { AppSidebar } from "~/components/app-sidebar";
import type { ChatCourseOption, ChatModelOption } from "~/components/chat/chat-view-types";
import { SiteHeader } from "~/components/site-header";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "~/components/ui/breadcrumb";
import { fetchChatSession } from "~/hooks/api/use-chat-sessions";
import { useCourses } from "~/hooks/api/use-courses";
import { useApiKeys } from "~/hooks/use-api-keys";
import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";
import { useAssistiveUi } from "~/components/assistive/assistive-ui-provider";
import { logChatApiResponse, logChatUseChatError } from "~/lib/chat-client-log";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession(request);

  if (!session?.user) {
    return redirect("/auth/login");
  }

  if (session.user.role !== "ADMIN") {
    return redirect("/dashboard");
  }

  const dbModels = await prisma.aIModel.findMany({
    where: { isActive: true },
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
  const { courses } = useCourses();
  const availableCourses: ChatCourseOption[] = courses.map((c) => ({
    id: c.id,
    name: c.name,
    code: c.code,
  }));

  const [selectedModel, setSelectedModel] = useState(() => {
    const toolCapable = chatModels.find((m) => m.supportsTools);
    return toolCapable?.id ?? (chatModels.length > 0 ? chatModels[0].id : "");
  });
  const [selectedCourseCode, setSelectedCourseCode] = useState<string | null>(
    availableCourses[0]?.code ?? null,
  );
  const [chatId, setChatId] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [adhdAssist, setAdhdAssist] = useState(false);
  const { getValidApiKeys } = useApiKeys();
  const { setAssistive } = useAssistiveUi();

  useEffect(() => {
    if (!selectedCourseCode && availableCourses.length > 0) {
      setSelectedCourseCode(availableCourses[0].code);
    }
  }, [availableCourses, selectedCourseCode]);

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

  const handleAssistChange = useCallback(
    (checked: boolean) => {
      setAdhdAssist(checked);
      setAssistive(checked);
    },
    [setAssistive],
  );

  const { messages, input, handleInputChange, handleSubmit, isLoading, stop } = useChat({
    api: "/api/chat",
    body: {
      chatMode: "admin",
      model: selectedModel,
      apiKeys: getValidApiKeys(),
      courseCode: selectedCourseCode || undefined,
      chatId: chatId || undefined,
      systemPrompt: systemPrompt || undefined,
      adhdAssist,
    },
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
        <SiteHeader
          breadcrumbs={
            <Breadcrumb>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link to="/dashboard">Home</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Admin Chatbot</BreadcrumbPage>
              </BreadcrumbItem>
            </Breadcrumb>
          }
        />
        <AdminChatView
          chatModels={chatModels}
          selectedModel={selectedModel}
          setSelectedModel={setSelectedModel}
          selectedModelInfo={selectedModelInfo}
          selectedCourseCode={selectedCourseCode}
          setSelectedCourseCode={setSelectedCourseCode}
          availableCourses={availableCourses}
          messages={messages}
          input={input}
          isLoading={isLoading}
          adhdAssist={adhdAssist}
          onAssistChange={handleAssistChange}
          systemPrompt={systemPrompt}
          onSystemPromptSave={handleSystemPromptSave}
          onInputChange={handleInputChange}
          onSubmit={handleSubmit}
          onStop={stop}
          onSelectPrompt={handlePromptSelect}
        />
      </SidebarInset>
    </SidebarProvider>
  );
}
