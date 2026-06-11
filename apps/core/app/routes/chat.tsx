import { useChat } from "@ai-sdk/react";
import { useCallback, useEffect, useState } from "react";
import { redirect, useLoaderData, useFetcher } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";


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
import { getUserPreference, saveUserPreference } from "~/lib/user-preferences.server";
import { getAccessibleCourseCodes } from "~/lib/courses/server";
import { parsePreferenceUpdates } from "~/lib/user-preferences";
import { useAssistiveUi } from "~/components/assistive/assistive-ui-provider";

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

  // Validate the persisted course against the courses THIS user can actually
  // access, so a stale / now-inaccessible `lastCourseCode` is dropped on restore
  // rather than treated as valid just because the course still exists (#420 review).
  const availableCourseCodes = await getAccessibleCourseCodes(session.user);
  const preferences = await getUserPreference(session.user.id, availableCourseCodes);

  return {
    chatModels,
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
  const { chatModels, user, assistDefault, lastCourseCode } = useLoaderData<typeof loader>();
  const isGlobalChat = usesGlobalChat(user);
  const { courses } = useCourses();
  const availableCourses: ChatCourseOption[] = isGlobalChat
    ? []
    : courses.map((c) => ({ id: c.id, name: c.name, code: c.code }));
  const [selectedModel, setSelectedModel] = useState(
    chatModels.length > 0 ? chatModels[0].id : "",
  );
  const [selectedCourseCode, setSelectedCourseCode] = useState<string | null>(
    lastCourseCode ?? null,
  );
  const [chatId, setChatId] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [adhdAssist, setAdhdAssist] = useState(assistDefault ?? false);
  const { getValidApiKeys } = useApiKeys();
  const { setAssistive } = useAssistiveUi();
  const prefsFetcher = useFetcher();

  const persistPreference = useCallback(
    (updates: { assistDefault?: boolean; lastCourseCode?: string | null }) => {
      prefsFetcher.submit(updates, { method: "post", encType: "application/json" });
    },
    [prefsFetcher],
  );

  const handleAssistChange = useCallback((checked: boolean) => {
    setAdhdAssist(checked);
    setAssistive(checked);
  }, [setAdhdAssist, setAssistive]);

  const handleCourseChange = useCallback((code: string | null) => {
    setSelectedCourseCode(code);
    persistPreference({ lastCourseCode: code });
  }, [setSelectedCourseCode, persistPreference]);

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
    setSelectedCourseCode: handleCourseChange,
    availableCourses,
    messages,
    input,
    isLoading,
    adhdAssist,
    onAssistChange: handleAssistChange,
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
          "--header-height": "calc(var(--spacing) * 14)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" user={user} />
      <SidebarInset>
        <SiteHeader title="Chat" />
        {isGlobalChat ? (
          <ChatGlobalView {...sharedViewProps} />
        ) : (
          <ChatCourseScopedView {...sharedViewProps} />
        )}
      </SidebarInset>
    </SidebarProvider>
  );
}
