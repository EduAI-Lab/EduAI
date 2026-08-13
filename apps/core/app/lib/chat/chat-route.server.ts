import { redirect } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

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
import { getRequestSession } from "~/lib/auth/request-session.server";

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

/**
 * Resolve the signed-in user for a chat route, or redirect to login.
 *
 * Split out of {@link loadChatBaseData} so `/chat/:chatId` can start the
 * transcript read (which needs only the viewer's id + role) concurrently with
 * the base-data reads instead of waiting for all of them first.
 */
export async function requireChatSessionUser(
  request: LoaderFunctionArgs["request"],
): Promise<User> {
  const session = await getRequestSession(request);

  if (!session?.user) {
    throw redirect("/auth/login");
  }

  return session.user;
}

/**
 * Resolve chat models + preferences for an already-authenticated user.
 *
 * The routing settings, the model registry read and the accessible course codes
 * are mutually independent, so they run in parallel. Only the preference read
 * is genuinely dependent — it needs `availableCourseCodes` to validate the
 * stored last-course against what the user can still see.
 */
export async function loadChatBaseDataForUser(user: User): Promise<ChatBaseData> {
  const [routingModelSettings, dbModels, availableCourseCodes] = await Promise.all([
    getRoutingModelSettings(),
    prisma.aIModel.findMany({
      where: { isActive: true, provider: { isActive: true } },
      // Select only what ChatModelOption needs. `include: { provider: true }`
      // pulled every model + provider column into memory to build a 7-field
      // object; the extra columns never reached the client either way.
      select: {
        modelId: true,
        name: true,
        description: true,
        maxTokens: true,
        supportsImages: true,
        supportsTools: true,
        provider: { select: { name: true } },
      },
      orderBy: [{ provider: { name: "asc" } }, { name: "asc" }],
    }),
    getAccessibleCourseCodes(user),
  ]);

  const routerAutoEnabled =
    routingModelSettings.autoLlmEnabled ||
    routingModelSettings.autoRulesEnabled;
  const showRoutingModels = routerAutoEnabled;

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

  const preferences = await getUserPreference(user.id, availableCourseCodes);

  return {
    chatModels,
    routerAutoEnabled,
    showRoutingModels,
    user,
    ...preferences,
  };
}

/** Resolve the signed-in user + chat models + preferences (or redirect to login). */
export async function loadChatBaseData(
  request: LoaderFunctionArgs["request"],
): Promise<ChatBaseData> {
  return loadChatBaseDataForUser(await requireChatSessionUser(request));
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
  const session = await getRequestSession(request);
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
