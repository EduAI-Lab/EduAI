import type { Message } from "@ai-sdk/react";

import { ChatInput } from "~/components/chat/chat-input";
import { ChatMessage } from "~/components/chat/chat-message";
import { ChatTypingIndicator } from "~/components/chat/chat-typing-indicator";
import { ChatWelcome } from "~/components/chat/chat-welcome";
import { SystemPromptSettings } from "~/components/chat/system-prompt-settings";
import type { ChatViewSharedProps } from "~/components/chat/chat-view-types";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";

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
  adhdAssist,
  onAssistChange,
  systemPrompt,
  onSystemPromptSave,
  onInputChange,
  onSubmit,
  onStop,
  onSelectPrompt,
  chatError,
  noModelsConfigured,
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

              {chatError && (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {chatError}
                </div>
              )}
              {noModelsConfigured && (
                <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm">
                  No model providers are configured. Open API key settings and add an OpenRouter key, or ask an admin to set{" "}
                  <code>OPENROUTER_API_KEY</code> on the server.
                </div>
              )}

              <div className="flex items-center justify-end gap-4">
                <div className="flex items-center gap-2">
                  <Switch
                    id="adhd-assist"
                    checked={adhdAssist}
                    onCheckedChange={(checked) => onAssistChange(Boolean(checked))}
                    aria-label="Assistive mode"
                  />
                  <Label htmlFor="adhd-assist" className="text-sm">
                    Assistive mode {adhdAssist ? "On" : "Off"}
                  </Label>
                </div>
                <SystemPromptSettings
                  systemPrompt={systemPrompt}
                  onSave={onSystemPromptSave}
                />
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
