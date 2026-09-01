import { useChat } from "@ai-sdk/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, redirect, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { z } from "zod";

import { AdminChatView } from "~/components/chat/admin-chat-view";
import { CoreAppShell } from "~/components/layout/core-app-shell";
import type { ChatModelOption } from "~/components/chat/chat-view-types";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@eduai/ui";
import { fetchChatSession } from "~/hooks/api/use-chat-sessions";
import prisma from "~/lib/prisma.server";
import { useAssistiveUi } from "~/components/assistive/assistive-ui-provider";
import { logChatApiResponse, logChatUseChatError } from "~/lib/chat-client-log";
import { getRequestSession } from "~/lib/auth/request-session.server";
import {
  cancelChatRequest,
  fetchChatWithRequestId,
} from "~/components/chat/chat-request-cancellation";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getRequestSession(request);

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

/** The `{ error, code }` shape every /api/chat rejection (chatApiReject) serves. */
const chatRejectionBodySchema = z
  .object({
    error: z.string().trim().min(1).optional().catch(undefined),
    code: z.string().optional().catch(undefined),
    // #987/#1113's rate-limit rejection carries no `code` (just the raw
    // `error: "RATE_LIMITED"` enum) but does carry this — without reading it
    // here, the banner would show the bare enum string with no explanation
    // and no mention of when to retry.
    retryAfter: z.number().optional().catch(undefined),
  })
  .catch({});

/** Provider/tool failures a fresh admin account is expected to hit before BYOK setup. */
const NEEDS_PROVIDER_SETUP_CODES = new Set(["INVALID_PROVIDER_CONFIG", "ADMIN_TOOLS_REQUIRED"]);

/**
 * Best-effort decode of a failed /api/chat call into a message an ADMIN can
 * act on. `useChat` (AI SDK v4) throws `new Error(await response.text())` for
 * any non-2xx response (see @ai-sdk/ui-utils), so the route's structured
 * `{ error, code }` rejection body round-trips as `error.message` — parsed
 * back out at this boundary via the schema above. Falls back to the raw
 * message (or a generic string) for a body that isn't JSON, e.g. a network
 * failure — `.catch({})` on the schema absorbs anything malformed instead of
 * throwing, so `JSON.parse` itself is the only thing this still needs to guard.
 *
 * #1656: without this, a rejected turn (most commonly ADMIN_TOOLS_REQUIRED or
 * INVALID_PROVIDER_CONFIG — no tool-capable model has a working provider key
 * configured yet) rendered as total silence: no reply, no error, nothing an
 * admin could act on short of opening devtools.
 */
function describeAdminChatError(error: Error): string {
  const fallback = error.message || "The admin chatbot could not respond.";

  let parsed: unknown;
  try {
    parsed = JSON.parse(error.message);
  } catch {
    return fallback;
  }

  const body = chatRejectionBodySchema.parse(parsed);
  if (!body.error) return fallback;
  if (body.error === "RATE_LIMITED") {
    // The schema already parses retryAfter as number | undefined (or drops
    // it via .catch on a malformed value) — no further narrowing needed.
    return body.retryAfter !== undefined
      ? `You're sending messages too quickly. Try again in ${body.retryAfter}s.`
      : "You're sending messages too quickly. Wait a moment and try again.";
  }
  if (body.code && NEEDS_PROVIDER_SETUP_CODES.has(body.code)) {
    return `${body.error} Open the settings (gear) icon next to the message box to add or fix a provider API key.`;
  }
  return body.error;
}

export default function AdminChatPage() {
  const { chatModels, user } = useLoaderData<typeof loader>();

  const [selectedModel, setSelectedModel] = useState(chatModels.length > 0 ? chatModels[0].id : "");
  const [chatId, setChatId] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [adhdAssist, setAdhdAssist] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [webToolsEnabled] = useState(false);
  const [routedModelByMessageId, setRoutedModelByMessageId] = useState<Record<string, string>>({});
  const [streamingRoutedRegistryId, setStreamingRoutedRegistryId] = useState<string | null>(null);
  // #1656: the only user-visible signal a rejected turn used to leave behind
  // was a console.error — from the admin's seat, sending a message did
  // nothing at all. Surfaced as a banner instead of another silent log line.
  const [chatError, setChatError] = useState<string | null>(null);
  const pendingRoutedRegistryIdRef = useRef<string | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
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

  const chatFetch = useCallback<typeof fetch>(
    (input, init) => fetchChatWithRequestId(activeRequestIdRef, input, init),
    [],
  );

  const { messages, input, handleInputChange, handleSubmit, isLoading, stop } = useChat({
    api: "/api/chat",
    fetch: chatFetch,
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
      const routed = routedHeader && routedHeader.length > 0 ? routedHeader : null;
      pendingRoutedRegistryIdRef.current = routed;
      setStreamingRoutedRegistryId(routed);
      // A response arriving at all — success or a rejection the SDK will
      // still hand to onError — means this turn is no longer the failure a
      // stale banner was describing.
      setChatError(null);

      await logChatApiResponse(response, "admin-chat");
      const chatIdHeader = response.headers.get("X-Chat-Id");
      if (chatIdHeader && !chatId) {
        setChatId(chatIdHeader);
      }
    },
    onFinish: (message) => {
      activeRequestIdRef.current = null;
      const routed = pendingRoutedRegistryIdRef.current;
      if (message.role === "assistant" && routed) {
        setRoutedModelByMessageId((prev) => ({ ...prev, [message.id]: routed }));
      }
      pendingRoutedRegistryIdRef.current = null;
      setStreamingRoutedRegistryId(null);
    },
    onError: (error) => {
      activeRequestIdRef.current = null;
      logChatUseChatError(error, "admin-chat");
      setChatError(describeAdminChatError(error));
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
    cancelChatRequest(activeRequestIdRef);
    pendingRoutedRegistryIdRef.current = null;
    setStreamingRoutedRegistryId(null);
    stop();
  }, [stop]);

  // Dismiss a stale error banner as soon as the admin tries again, rather
  // than leaving the previous turn's failure on screen next to a new reply.
  const handleChatSubmit = useCallback<typeof handleSubmit>(
    (event) => {
      setChatError(null);
      handleSubmit(event);
    },
    [handleSubmit],
  );

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
      handleChatSubmit(formEvent);
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
      {chatError && (
        <Alert variant="destructive" className="mx-4 mt-4 shrink-0 md:mx-6">
          <AlertTitle>Admin chatbot couldn&apos;t respond</AlertTitle>
          <AlertDescription>{chatError}</AlertDescription>
        </Alert>
      )}
      <AdminChatView
        chatModels={chatModels}
        selectedModel={selectedModel}
        setSelectedModel={setSelectedModel}
        selectedModelInfo={selectedModelInfo}
        selectedCourseId={null}
        selectedCourseCode={null}
        setSelectedCourseId={() => {}}
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
        onSubmit={handleChatSubmit}
        onStop={handleStop}
        onSelectPrompt={handlePromptSelect}
        routedModelByMessageId={routedModelByMessageId}
        streamingRoutedRegistryId={streamingRoutedRegistryId}
      />
    </CoreAppShell>
  );
}
