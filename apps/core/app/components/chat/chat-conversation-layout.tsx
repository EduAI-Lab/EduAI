import type { Message } from "@ai-sdk/react";
import { IconArrowDown, IconBooksOff } from "@tabler/icons-react";

import { ChatDisclaimer } from "~/components/chat/chat-disclaimer";
import { ChatInput } from "~/components/chat/chat-input";
import { ChatMessage } from "~/components/chat/chat-message";
import { ChatTypingIndicator } from "~/components/chat/chat-typing-indicator";
import { ChatWelcome } from "~/components/chat/chat-welcome";
import type { ChatWelcomeProps } from "~/components/chat/chat-welcome";
import type { ChatViewSharedProps } from "~/components/chat/chat-view-types";
import { useChatProgress } from "~/components/chat/use-chat-progress";
import { displayNameForRegistryId } from "~/lib/chat-auto-model";
import {
  ASSISTIVE_CHAT_SURFACE_CLASS,
  resolveMessageHighlightRole,
} from "~/components/assistive/active-highlight";
import { useMotionReducedPreference } from "~/components/assistive/ui-preferences-provider";
import { cn } from "~/lib/utils";
import { CHAT_SCROLL_PANE_CLASS } from "~/components/chat/chat-scroll-pane";
import { useStickToBottom } from "~/components/chat/use-stick-to-bottom";

type ChatConversationLayoutProps = ChatViewSharedProps & {
  bannerTitle?: string;
  bannerDescription?: string;
  showCourseSelector: boolean;
  WelcomeComponent?: React.ComponentType<ChatWelcomeProps>;
  assistive: boolean;
  onAssistiveChange: (value: boolean) => void;
  focusMode: boolean;
  onFocusModeChange: (value: boolean) => void;
};

export function ChatConversationLayout({
  bannerTitle: _bannerTitle,
  bannerDescription: _bannerDescription,
  showCourseSelector,
  chatModels,
  selectedModel,
  setSelectedModel,
  selectedModelInfo,
  selectedCourseId,
  selectedCourseCode,
  setSelectedCourseId,
  availableCourses,
  courseSelectionKey = "code",
  messages,
  input,
  isLoading,
  adhdAssist,
  assistive,
  onAssistiveChange,
  assistBusy,
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
  routedModelByMessageId = {},
  streamingRoutedRegistryId = null,
  cappedMessageIds,
  onContinue,
  wasAutoRoutedByMessageId = {},
  streamingWasAutoRouted = false,
  adhdAssistByMessageId = {},
  streamingAdhdAssist = false,
}: ChatConversationLayoutProps) {
  const {
    startedAt,
    deadlineMs,
    typicalExpectedMs,
    hasAssistantText,
    hasRoutedModel,
    activeToolName,
    awaitingFollowup,
    showProgressIndicator,
    compactProgress,
  } = useChatProgress({
    isLoading,
    messages,
    adhdAssist,
    selectedModel,
    streamingRoutedRegistryId,
  });

  const { paneRef, contentRef, pinned, scrollToBottom } = useStickToBottom<
    HTMLDivElement,
    HTMLDivElement
  >(messages);
  // Native smooth scrolling animates regardless of the app's reduce-motion
  // setting, so the jump has to opt out of it explicitly.
  const motionReduced = useMotionReducedPreference();

  return (
    <div
      className={cn(
        // Fill the AppShell main pane — do NOT use 100vh here. Nested inside
        // SiteHeader + main, a viewport calc makes the page taller than the
        // screen and lets you scroll past the composer (#1060 follow-up).
        "flex h-full min-h-0 flex-1 flex-col bg-background",
        assistive && ASSISTIVE_CHAT_SURFACE_CLASS,
      )}
    >
      <div className="flex-1 flex flex-col min-h-0 relative overflow-hidden">
        {disabledReason === "no-courses" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/85 backdrop-blur-[2px]">
            <IconBooksOff className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground text-center max-w-xs leading-relaxed">
              You're not enrolled in any courses.
              <br />
              Chat will become available once you're enrolled.
            </p>
          </div>
        )}
        {/* #1320: overflow-x-hidden is required alongside overflow-y-auto --
            per spec, an axis left unset next to a non-"visible" sibling axis
            computes to "auto" (not "visible"), so wide message content (an
            eduai-diagram widget wider than its intended max-w-3xl column)
            silently opened a horizontal scroll region here instead of
            wrapping/shrinking, effectively rendering it off-screen. */}
        <div ref={paneRef} className={CHAT_SCROLL_PANE_CLASS}>
          <div
            ref={contentRef}
            className={cn(
              "px-4 md:px-6",
              messages.length === 0 ? "flex min-h-full flex-col" : "py-4 md:py-6",
            )}
          >
            {isStudentWithCourseChat && (
              <div
                className={cn(
                  "mx-auto w-full max-w-3xl",
                  messages.length === 0 ? "pt-4 pb-2" : "mb-4",
                )}
              >
                <p className="text-center text-xs text-muted-foreground">
                  Instructors, teaching assistants, and platform admins can view this course chat
                  history.
                </p>
              </div>
            )}
            <div className="mx-auto w-full max-w-3xl mb-4">
              <ChatDisclaimer />
            </div>
            <div
              className={cn(
                "mx-auto w-full max-w-3xl",
                messages.length === 0 ? "flex flex-1 flex-col pb-6" : "space-y-1",
              )}
            >
              {messages.length === 0 ? (
                <div className="my-auto w-full">
                  <WelcomeComponent
                    selectedModelInfo={selectedModelInfo}
                    selectedCourseCode={selectedCourseCode}
                    onSelectPrompt={onSelectPrompt}
                    disabled={!!disabledReason}
                  />
                </div>
              ) : (
                <>
                  {messages.map((message, index) => {
                    const isLastMessage = index === messages.length - 1;
                    const isStreamingMessage = isLastMessage && isLoading;

                    const routedRegistryId =
                      message.role === "assistant"
                        ? (routedModelByMessageId[message.id] ??
                          (isStreamingMessage ? streamingRoutedRegistryId : null))
                        : null;
                    // Whether *that turn* was requested with an auto mode — not
                    // the live selector, which may have changed since (#829).
                    const wasAutoRouted =
                      message.id in wasAutoRoutedByMessageId
                        ? wasAutoRoutedByMessageId[message.id]
                        : isStreamingMessage
                          ? streamingWasAutoRouted
                          : false;
                    const answeredByLabel =
                      !wasAutoRouted && routedRegistryId
                        ? displayNameForRegistryId(routedRegistryId, chatModels)
                        : undefined;

                    // What Assist mode *that turn* was generated under — not
                    // the live toggle, which may have changed since (#1671).
                    // Legacy messages persisted before this metadata existed
                    // fall back to the live toggle, matching prior behavior.
                    const messageAdhdAssist =
                      message.id in adhdAssistByMessageId
                        ? adhdAssistByMessageId[message.id]
                        : isStreamingMessage
                          ? streamingAdhdAssist
                          : adhdAssist;

                    return (
                      <ChatMessage
                        key={message.id}
                        message={message as Message}
                        isStreaming={isStreamingMessage}
                        answeredByLabel={answeredByLabel}
                        highlightRole={resolveMessageHighlightRole(index, messages, assistive)}
                        webToolsEnabled={webToolsEnabled}
                        assistiveDisplay={messageAdhdAssist}
                        showContinue={cappedMessageIds?.has(message.id) ?? false}
                        onContinue={onContinue ? () => onContinue(message.id) : undefined}
                        continueDisabled={isLoading}
                      />
                    );
                  })}

                  {showProgressIndicator && (
                    <ChatTypingIndicator
                      startedAt={startedAt}
                      deadlineMs={deadlineMs}
                      typicalExpectedMs={typicalExpectedMs}
                      hasAssistantText={hasAssistantText}
                      hasRoutedModel={hasRoutedModel}
                      activeToolName={activeToolName}
                      adhdAssist={adhdAssist}
                      awaitingFollowup={awaitingFollowup}
                      compact={compactProgress}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Only offered once the reader has scrolled away from a non-empty
            transcript — while pinned there is nothing to jump to. */}
        {!pinned && messages.length > 0 && (
          <button
            type="button"
            onClick={() => scrollToBottom(motionReduced ? "auto" : "smooth")}
            aria-label="Jump to latest message"
            className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-background/95 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-md backdrop-blur transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <IconArrowDown className="h-3.5 w-3.5" />
            Jump to latest
          </button>
        )}
      </div>

      <ChatInput
        input={input}
        isLoading={isLoading}
        onInputChange={onInputChange}
        onSubmit={onSubmit}
        onStop={onStop}
        selectedCourseId={selectedCourseId}
        setSelectedCourseId={setSelectedCourseId}
        availableCourses={availableCourses}
        courseSelectionKey={courseSelectionKey}
        selectedModel={selectedModel}
        setSelectedModel={setSelectedModel}
        chatModels={chatModels}
        selectedModelInfo={selectedModelInfo}
        showCourseSelector={showCourseSelector}
        adhdAssist={adhdAssist}
        onAdhdAssistChange={onAssistiveChange}
        assistBusy={assistBusy}
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
