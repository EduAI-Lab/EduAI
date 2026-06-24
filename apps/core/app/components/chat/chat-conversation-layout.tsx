import type { Message } from "@ai-sdk/react";
import { IconInfoCircle, IconBooksOff } from "@tabler/icons-react";
import { Alert, AlertDescription } from "@eduai/ui";

import { ChatInput } from "~/components/chat/chat-input";
import { ChatMessage } from "~/components/chat/chat-message";
import { ChatTypingIndicator } from "~/components/chat/chat-typing-indicator";
import { ChatWelcome } from "~/components/chat/chat-welcome";
import type { ChatWelcomeProps } from "~/components/chat/chat-welcome";
import type { ChatViewSharedProps } from "~/components/chat/chat-view-types";
import {
  ASSISTIVE_CHAT_SURFACE_CLASS,
  resolveMessageHighlightRole,
} from "~/components/assistive/active-highlight";
import { cn } from "~/lib/utils";

type ChatConversationLayoutProps = ChatViewSharedProps & {
  bannerTitle?: string;
  bannerDescription?: string;
  showCourseSelector: boolean;
  WelcomeComponent?: React.ComponentType<ChatWelcomeProps>;
};

export function ChatConversationLayout({
  bannerTitle: _bannerTitle,
  bannerDescription: _bannerDescription,
  showCourseSelector,
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
  assistive,
  onAssistiveChange,
  focusMode,
  onFocusModeChange,
  webToolsEnabled,
  systemPrompt,
  onSystemPromptSave,
  onInputChange,
  onSubmit,
  onStop,
  onSelectPrompt,
  WelcomeComponent = ChatWelcome,
  isStudentWithCourseChat,
  disabledReason,
}: ChatConversationLayoutProps) {
  return (
    <div
      className={cn(
        "flex flex-col h-[calc(100vh-var(--header-height))] bg-background",
        assistive && ASSISTIVE_CHAT_SURFACE_CLASS,
      )}
    >
      {/* Disclaimer banner for students in course-scoped chat */}
      <div className="flex-1 flex flex-col min-h-0 relative overflow-hidden">
        {/* No-courses overlay: covers welcome screen and disables all interaction */}
        {disabledReason === 'no-courses' && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/85 backdrop-blur-[2px]">
            <IconBooksOff className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground text-center max-w-xs leading-relaxed">
              You're not enrolled in any courses.<br />
              Chat will become available once you're enrolled.
            </p>
          </div>
        )}
        <div className="h-full overflow-y-auto scrollbar-hover">
          <div className="px-6 py-6">
            {isStudentWithCourseChat && (
                <div className="max-w-[720px] mx-auto">
                  <Alert className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950">
                    <IconInfoCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <AlertDescription className="text-sm text-amber-900 dark:text-amber-100">
                      Heads up: your course chats can be viewed by your instructor, unit admin, and platform admins.
                    </AlertDescription>
                  </Alert>
                </div>
            )}
            <div className="max-w-[720px] mx-auto space-y-5">
              {messages.length === 0 ? (
                <WelcomeComponent
                  selectedModelInfo={selectedModelInfo}
                  onSelectPrompt={onSelectPrompt}
                  disabled={!!disabledReason}
                />
              ) : (
                <>
                  {messages.map((message, index) => {
                    const isLastMessage = index === messages.length - 1;
                    const isStreamingMessage = isLastMessage && isLoading;

                    return (
                      <ChatMessage
                        key={message.id}
                        message={message as Message}
                        isStreaming={isStreamingMessage}
                        highlightRole={resolveMessageHighlightRole(
                          index,
                          messages,
                          assistive,
                        )}
                        webToolsEnabled={webToolsEnabled}
                      />
                    );
                  })}

                  {isLoading && <ChatTypingIndicator />}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <ChatInput
        input={input}
        isLoading={isLoading}
        onInputChange={onInputChange}
        onSubmit={onSubmit}
        onStop={onStop}
        selectedCourseId={selectedCourseCode}
        setSelectedCourseId={setSelectedCourseCode}
        availableCourses={availableCourses}
        selectedModel={selectedModel}
        setSelectedModel={setSelectedModel}
        chatModels={chatModels}
        selectedModelInfo={selectedModelInfo}
        showCourseSelector={showCourseSelector}
        adhdAssist={adhdAssist}
        onAdhdAssistChange={onAssistiveChange}
        focusMode={focusMode}
        onFocusModeChange={onFocusModeChange}
        assistiveHighlight={assistive}
        systemPrompt={systemPrompt}
        onSystemPromptSave={onSystemPromptSave}
        disabledReason={disabledReason}
      />
    </div>
  );
}
