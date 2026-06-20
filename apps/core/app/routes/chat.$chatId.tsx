import { redirect, useLoaderData } from "react-router";
import { Link } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { ChatPage } from "~/components/chat/chat-page";
import { ChatTranscriptViewer } from "~/components/chat/chat-transcript-viewer";
import { AppSidebar } from "~/components/app-sidebar";
import { SiteHeader } from "~/components/site-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  SidebarInset,
  SidebarProvider,
} from "@eduai/ui";
import { auth } from "~/lib/auth/server";
import { canAccessChat, getChatMessages } from "~/lib/chat-history/server";
import { reviveStoredMessage } from "~/lib/chat-history/revive";
import prisma from "~/lib/prisma.server";
import { getUserPreference } from "~/lib/user-preferences.server";
import { getAccessibleCourseCodes } from "~/lib/courses/server";
import type { ChatModelOption } from "~/components/chat/chat-view-types";
import type { ChatTranscript } from "~/hooks/api/use-chat-history";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const session = await auth.api.getSession(request);
  if (!session?.user) return redirect("/auth/login");

  const chatId = params.chatId;
  if (!chatId) return redirect("/chat");

  const { chat, canEdit } = await canAccessChat(
    { id: session.user.id, role: session.user.role },
    chatId,
  );

  if (!chat) return redirect("/chat");

  const rows = await getChatMessages(chatId);
  const messages = rows.map(reviveStoredMessage);

  const transcript: ChatTranscript = {
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
      updatedAt: chat.updatedAt.toISOString(),
    },
    messages,
    canEdit,
  };

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

  const availableCourseCodes = await getAccessibleCourseCodes(session.user);
  const preferences = await getUserPreference(session.user.id, availableCourseCodes);

  return {
    chatId,
    transcript,
    canEdit,
    chatModels,
    user: session.user,
    ...preferences,
  };
}

export default function ChatById() {
  const { chatId, transcript, canEdit, chatModels, user, assistDefault, lastCourseCode } =
    useLoaderData<typeof loader>();

  if (!canEdit) {
    return (
      <SidebarProvider
        style={
          {
            "--sidebar-width": "calc(var(--spacing) * 72)",
            "--header-height": "calc(var(--spacing) * 12)",
          } as React.CSSProperties
        }
      >
        <AppSidebar user={user} />
        <SidebarInset>
          <SiteHeader
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
                    <BreadcrumbLink asChild>
                      <Link to="/chat">Chat</Link>
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>
                      {transcript.chat.title ?? "Conversation"}
                    </BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            }
          />
          <div className="flex-1 overflow-y-auto px-5 py-4 max-w-3xl mx-auto w-full">
            <ChatTranscriptViewer
              messages={transcript.messages}
              ownerName={transcript.chat.ownerName}
              courseCode={transcript.chat.courseCode}
            />
          </div>
        </SidebarInset>
      </SidebarProvider>
    );
  }

  return (
    <ChatPage
      chatModels={chatModels}
      user={user}
      assistDefault={assistDefault}
      lastCourseCode={lastCourseCode}
      initialChatId={chatId}
      initialTranscript={transcript}
    />
  );
}