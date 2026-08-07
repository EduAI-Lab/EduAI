import { redirect } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";
import { getAccessibleCourseCodes } from "~/lib/courses/server";
import { getUserPreference, saveUserPreference } from "~/lib/user-preferences.server";
import { parsePreferenceUpdates } from "~/lib/user-preferences";
import { resolveChatReadAccess, getChatMessages } from "~/lib/chat-history/server";
import { reviveStoredMessage } from "~/lib/chat/revive-message.server";
import { withAutoChatModel } from "~/lib/chat-auto-model";
import { getRoutingModelSettings } from "~/lib/routing-model-settings.server";
import type { ChatModelOption } from "~/components/chat/chat-view-types";
import type { ChatTranscript } from "~/hooks/api/use-chat-history";
import type { User } from "~/lib/auth/types";

/**
 * Shared loader data for both chat routes (`/chat` and `/chat/:chatId`). The
 * route is the source of truth for which conversation is open, so both routes
 * resolve the same base context (models + preferences) and the `:chatId` route
 * additionally hydrates the transcript from the DB via {@link loadChatTranscript}.
 */
export interface ChatBaseData {
  chatModels: ChatModelOption[];
  routerAutoEnabled: boolean;
  showRoutingModels: boolean;
  user: User;
  assistDefault: boolean;
  lastCourseCode: string | null;
  motionReduced: boolean;
  density: string;
  theme: string;
}

/** Resolve the signed-in user + chat models + preferences (or redirect to login). */
export async function loadChatBaseData(
  request: LoaderFunctionArgs["request"],
): Promise<ChatBaseData> {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    throw redirect("/auth/login");
  }

  const routingModelSettings = await getRoutingModelSettings();
  const routerAutoEnabled =
    routingModelSettings.autoLlmEnabled ||
    routingModelSettings.autoRulesEnabled;
  const showRoutingModels = routerAutoEnabled;

  const dbModels = await prisma.aIModel.findMany({
    where: { isActive: true, provider: { isActive: true } },
    include: { provider: true },
    orderBy: [{ provider: { name: "asc" } }, { name: "asc" }],
  });

  const registryModels: ChatModelOption[] = dbModels.map((model) => ({
    id: `${model.provider.name}:${model.modelId}`,
    name: model.name,
    description: model.description,
    provider: model.provider.name,
    maxTokens: model.maxTokens || undefined,
    supportsImages: model.supportsImages,
    supportsTools: model.supportsTools,
  }));

  const chatModels = withAutoChatModel(registryModels, routingModelSettings);

  const availableCourseCodes = await getAccessibleCourseCodes(session.user);
  const preferences = await getUserPreference(session.user.id, availableCourseCodes);

  return {
    chatModels,
    routerAutoEnabled,
    showRoutingModels,
    user: session.user,
    ...preferences,
  };
}

/**
 * Load a chat transcript for `/chat/:chatId` directly from the DB so the route
 * — not sessionStorage — is the source of truth. Reuses the §5c read-access
 * contract: returns null when the chat is missing OR the viewer may not read it
 * (callers redirect to `/chat`, so there is no existence leak).
 */
export async function loadChatTranscript(
  viewer: { id: string; role?: string | null },
  chatId: string,
): Promise<ChatTranscript | null> {
  const access = await resolveChatReadAccess(
    { id: viewer.id, role: viewer.role },
    chatId,
  );
  if (!access) return null;

  const { chat, canEdit } = access;
  const rows = await getChatMessages(chatId);

  return {
    chat: {
      id: chat.id,
      title: chat.title,
      systemPrompt: chat.systemPrompt,
      adhdAssist: chat.adhdAssist,
      courseId: chat.courseId,
      courseCode: chat.course?.code ?? null,
      courseName: chat.course?.name ?? null,
      ownerId: chat.userId,
      ownerName: chat.user.name,
      updatedAt:
        chat.updatedAt instanceof Date
          ? chat.updatedAt.toISOString()
          : String(chat.updatedAt),
    },
    messages: rows.map(reviveStoredMessage),
    canEdit,
  };
}

/** Shared preference-save action for both chat routes (POST to the open route). */
export async function chatPreferencesAction({ request }: ActionFunctionArgs) {
  const session = await auth.api.getSession({ headers: request.headers });
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
