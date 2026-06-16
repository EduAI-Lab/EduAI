import type { Message } from "@ai-sdk/react";

import { ChatInput } from "~/components/chat/chat-input";
import { ChatMessage } from "~/components/chat/chat-message";
import { ChatTypingIndicator } from "~/components/chat/chat-typing-indicator";
import { ChatWelcome } from "~/components/chat/chat-welcome";
import type { ChatViewSharedProps } from "~/components/chat/chat-view-types";

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
  onAssistChange,
  systemPrompt,
  onSystemPromptSave,
  onInputChange,
  onSubmit,
  onStop,
  onSelectPrompt,
  webToolsEnabled,
}: ChatConversationLayoutProps) {
  return (
    <div
      className="flex flex-col h-[calc(100vh-var(--header-height))] bg-background"
    >
      <div className="flex-1 flex flex-col min-h-0 relative overflow-hidden">
        <div className="h-full overflow-y-auto scrollbar-hover">
          <div className="px-6 py-6">
            <div className="max-w-[720px] mx-auto space-y-5">
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
        onAdhdAssistChange={onAssistChange}
        systemPrompt={systemPrompt}
        onSystemPromptSave={onSystemPromptSave}
      />
    </div>
  );
}
