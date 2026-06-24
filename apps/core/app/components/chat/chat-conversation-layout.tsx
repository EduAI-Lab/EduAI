import type { Message } from "@ai-sdk/react";
import { IconBooksOff } from "@tabler/icons-react";

import { ChatDisclaimer } from "~/components/chat/chat-disclaimer";
import { ChatInput } from "~/components/chat/chat-input";
import { ChatMessage } from "~/components/chat/chat-message";
import { ChatTypingIndicator } from "~/components/chat/chat-typing-indicator";
import { ChatWelcome } from "~/components/chat/chat-welcome";
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
      <div className="flex-1 flex flex-col min-h-0 relative overflow-hidden">
        {/* No-courses overlay: covers welcome screen and disables all interaction */}
        {disabledReason === "no-courses" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/85 backdrop-blur-[2px]">
            <IconBooksOff className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground text-center max-w-xs leading-relaxed">
              You're not enrolled in any courses.<br />
              Chat will become available once you're enrolled.
            </p>
          </div>
        )}
        <div className="h-full overflow-y-auto scrollbar-hover scroll-smooth">
          <div className="px-4 py-4 md:px-6 md:py-6">
            {isStudentWithCourseChat && (
              <div className="max-w-3xl mx-auto mb-4">
                <p className="text-xs text-muted-foreground text-center">
                  Course chats may be viewed by your instructor and platform admins.
                </p>
              </div>
            )}
            <div className="max-w-3xl mx-auto mb-4">
              <ChatDisclaimer />
            </div>
            <div className="max-w-3xl mx-auto space-y-1">
              {messages.length === 0 ? (
                <ChatWelcome
                  selectedModelInfo={selectedModelInfo}
                  onSelectPrompt={onSelectPrompt}
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
                        assistiveDisplay={adhdAssist}
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
      />
    </div>
  );
}
