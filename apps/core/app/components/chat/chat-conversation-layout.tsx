import type { Message } from "@ai-sdk/react";

import { ChatInput } from "~/components/chat/chat-input";
import { ChatMessage } from "~/components/chat/chat-message";
import { ChatTypingIndicator } from "~/components/chat/chat-typing-indicator";
import { ChatWelcome } from "~/components/chat/chat-welcome";
import type { ChatViewSharedProps } from "~/components/chat/chat-view-types";

type ChatConversationLayoutProps = ChatViewSharedProps & {
  bannerTitle: string;
  bannerDescription: string;
  showCourseSelector: boolean;
};

export function ChatConversationLayout({
  bannerTitle,
  bannerDescription,
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
  onInputChange,
  onSubmit,
  onStop,
  onSelectPrompt,
}: ChatConversationLayoutProps) {
  return (
    <div className="flex flex-col h-[calc(100vh-var(--header-height))] bg-gradient-to-br from-background via-background to-muted/20">
      <div className="flex-1 flex flex-col min-h-0 relative">
        <div className="h-full overflow-y-auto scrollbar-hover">
          <div className="px-4 py-6">
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="rounded-lg border bg-muted/30 px-4 py-3">
                <p className="font-medium">{bannerTitle}</p>
                <p className="text-sm text-muted-foreground">{bannerDescription}</p>
              </div>

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
      />
    </div>
  );
}
