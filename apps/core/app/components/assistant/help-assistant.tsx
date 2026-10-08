/**
 * The site-wide help assistant (#1822), mounted once in `CoreAppShell`.
 *
 * - Render condition is server-decided (root loader): where the assistant could
 *   never answer, nothing renders — no markup at all.
 * - Mounted is not visible: the bubble shows when documentation is available, or
 *   the page published a context whose material scope is true.
 * - On the full-height chat screens a floating bubble would sit on top of the
 *   message composer, so there the assistant opens from a header button instead
 *   (same panel, same threads) and never competes with the page's own chatbot.
 * - Answers render through `AnswerView` as text, never HTML.
 *
 * The persona name comes from `ASSISTANT_DISPLAY_NAME` only.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useLocation, useRouteLoaderData } from "react-router";
import {
  IconArrowUp,
  IconMessagePlus,
  IconSettings,
  IconSparkles,
  IconX,
} from "@tabler/icons-react";
import { Button, Textarea } from "@eduai/ui";

import type { loader as rootLoader } from "~/root";
import { ASSISTANT_DISPLAY_NAME } from "~/lib/assistant/assistant-settings";
import {
  isAssistantVisible,
  type AssistantGateSnapshot,
  type PublishedAssistantContext,
} from "~/lib/assistant/assistant-visibility";

import { AnswerSources, AnswerView } from "./answer-view";
import {
  onAssistantOpenRequest,
  requestClearMaterialScope,
  usePublishedAssistantContext,
} from "./assistant-events";
import { AssistantSettingsPane } from "./assistant-settings-pane";
import {
  getThread,
  sendAssistantQuestion,
  setAssistantDraft,
  setAssistantOpen,
  setAssistantView,
  startNewConversation,
  useAssistantStore,
} from "./assistant-store";
import { threadScopeKey, type ThreadMessage } from "./assistant-thread";
import { buildAssistantIntro } from "./intro-copy";

/** Routes whose page is itself a full-height chat with a composer at the bottom. */
const CHAT_SCREEN_PREFIXES = ["/chat", "/instructor/chat", "/admin/chat"];

export function assistantPlacementFor(pathname: string): "floating" | "header" {
  return CHAT_SCREEN_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
    ? "header"
    : "floating";
}

/** Attribute on <html> that lifts the toast stack clear of a VISIBLE bubble. */
export const BUBBLE_VISIBLE_ATTRIBUTE = "data-assistant-bubble";

/** The gate snapshot, the published page context, and what follows from them. */
export function useAssistantVisibility() {
  const rootData = useRouteLoaderData<typeof rootLoader>("root");
  const gate: AssistantGateSnapshot | undefined =
    rootData && "assistant" in rootData ? rootData.assistant : undefined;
  const published = usePublishedAssistantContext();
  const { pathname } = useLocation();
  return {
    gate,
    published,
    visible: isAssistantVisible(gate, published),
    placement: assistantPlacementFor(pathname),
  };
}

const PANEL_ID = "eduai-help-assistant-panel";
const NO_MESSAGES: ThreadMessage[] = [];

/** The header trigger used on chat screens. Renders nothing elsewhere. */
export function AssistantHeaderButton() {
  const { visible, placement } = useAssistantVisibility();
  const { open } = useAssistantStore();
  if (!visible || placement !== "header") return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="gap-1.5"
      aria-label={`Ask ${ASSISTANT_DISPLAY_NAME}, the help assistant`}
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-controls={open ? PANEL_ID : undefined}
      onClick={() => setAssistantOpen(!open)}
    >
      <IconSparkles className="size-4" aria-hidden />
      <span className="hidden sm:inline">Ask {ASSISTANT_DISPLAY_NAME}</span>
    </Button>
  );
}

function scopeHeading(context: PublishedAssistantContext | null): string {
  if (!context?.materialScope) return "Help with EduAI";
  return context.label;
}

function MessageBubble({
  message,
  onOpenSettings,
}: {
  message: ThreadMessage;
  onOpenSettings: () => void;
}) {
  if (message.role === "user") {
    return (
      <div className="ml-8 self-end whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
        {message.content}
      </div>
    );
  }
  if (message.error) {
    return (
      <div className="mr-8 rounded-2xl rounded-bl-sm border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
        <div>{message.error.message}</div>
        {message.error.code === "no_key" || message.error.code === "provider_error" ? (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto px-0"
            onClick={onOpenSettings}
          >
            Open assistant settings
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="mr-4 break-words rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm leading-relaxed text-foreground">
      <AnswerView answer={message.content} />
      <AnswerSources sources={message.sources ?? []} />
    </div>
  );
}

export function HelpAssistant({ user }: { user: { id: string; role?: string | null } }) {
  const { gate, published, visible, placement } = useAssistantVisibility();
  const store = useAssistantStore();
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const scopeKey = threadScopeKey(published);
  const pending = store.pending.has(scopeKey);
  const open = store.open && visible;
  // Threads live in sessionStorage, so they are read only while the panel is open
  // — which never happens during server rendering.
  const messages = open ? getThread(user.id, scopeKey) : NO_MESSAGES;
  const floating = placement === "floating";

  // Toast clearance follows the VISIBLE floating bubble, not mere mounting.
  useEffect(() => {
    const root = document.documentElement;
    if (visible && floating) root.setAttribute(BUBBLE_VISIBLE_ATTRIBUTE, "visible");
    else root.removeAttribute(BUBBLE_VISIBLE_ATTRIBUTE);
    return () => root.removeAttribute(BUBBLE_VISIBLE_ATTRIBUTE);
  }, [visible, floating]);

  // Escape closes from anywhere, whatever has focus inside the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // A Radix Select inside the settings pane handles its own Escape first.
      if (document.querySelector("[data-radix-popper-content-wrapper]")) return;
      setAssistantOpen(false);
      toggleRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // The help page's "Ask a question" (and similar) open the panel here.
  useEffect(
    () =>
      onAssistantOpenRequest(({ draft }) => {
        if (draft !== undefined) setAssistantDraft(draft);
        setAssistantView("chat");
        setAssistantOpen(true);
      }),
    [],
  );

  // A pre-filled draft moves into the composer once.
  useEffect(() => {
    if (store.draft) {
      setInput(store.draft);
      setAssistantDraft("");
    }
  }, [store.draft]);

  // Focus moves into the input when the panel opens on the conversation.
  useEffect(() => {
    if (open && store.view === "chat") inputRef.current?.focus();
  }, [open, store.view]);

  // Keep the newest message in view.
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages.length, pending, open]);

  if (!gate?.mounted || !visible) return null;

  const intro = buildAssistantIntro({
    role: user.role,
    scopeLabel: published?.materialScope ? published.label : null,
    isMaterial: Boolean(published?.materialScope && published.materialId),
    docs: gate.docs,
  });

  const send = (text: string) => {
    if (!text.trim() || pending) return;
    setInput("");
    void sendAssistantQuestion({ userId: user.id, scopeKey, question: text, context: published });
  };

  const onComposerKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send(input);
    }
  };

  const panelPosition = floating
    ? "bottom-[5.25rem] right-4 sm:right-6"
    : "top-[4.25rem] right-4 sm:right-6";

  return (
    <>
      {floating ? (
        <button
          ref={toggleRef}
          type="button"
          aria-label={
            open
              ? `Close ${ASSISTANT_DISPLAY_NAME}, the help assistant`
              : `Ask ${ASSISTANT_DISPLAY_NAME}, the help assistant`
          }
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-controls={open ? PANEL_ID : undefined}
          onClick={() => setAssistantOpen(!open)}
          className="fixed right-4 bottom-4 z-40 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-1 ring-black/5 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:right-6 sm:bottom-6"
        >
          {open ? (
            <IconX className="size-5" aria-hidden />
          ) : (
            <IconSparkles className="size-5" aria-hidden />
          )}
        </button>
      ) : null}

      {open ? (
        <section
          id={PANEL_ID}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          data-assistant-panel=""
          className={`fixed ${panelPosition} z-40 flex h-[min(36rem,calc(100dvh-9rem))] w-[min(25rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-[var(--radius-xl)] border border-border bg-popover text-popover-foreground shadow-xl`}
        >
          <div className="flex items-start gap-2.5 border-b border-border px-3 py-2.5">
            <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <IconSparkles className="size-4 text-primary-text" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              {/* Not an <h2>: keeps the title out of reach of page stylesheets
                  that style bare headings, with the same accessibility tree. */}
              <span
                id={titleId}
                role="heading"
                aria-level={2}
                className="block text-sm font-semibold"
              >
                {ASSISTANT_DISPLAY_NAME}
              </span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className="truncate" title={scopeHeading(published)}>
                  {scopeHeading(published)}
                </span>
                {published?.materialScope && published.materialId ? (
                  <button
                    type="button"
                    onClick={requestClearMaterialScope}
                    className="shrink-0 rounded px-1 text-[0.6875rem] underline-offset-2 hover:underline"
                  >
                    Back to course
                  </button>
                ) : null}
              </span>
            </div>
            <div className="flex shrink-0 items-center">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Start a new conversation"
                title="New conversation"
                disabled={messages.length === 0 || pending}
                onClick={() => startNewConversation(user.id, scopeKey)}
              >
                <IconMessagePlus className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Assistant settings"
                aria-pressed={store.view === "settings"}
                title="Settings"
                onClick={() => setAssistantView(store.view === "settings" ? "chat" : "settings")}
              >
                <IconSettings className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={`Close ${ASSISTANT_DISPLAY_NAME}`}
                onClick={() => {
                  setAssistantOpen(false);
                  toggleRef.current?.focus();
                }}
              >
                <IconX className="size-4" aria-hidden />
              </Button>
            </div>
          </div>

          {store.view === "settings" ? (
            <AssistantSettingsPane onBack={() => setAssistantView("chat")} />
          ) : (
            <>
              <div
                ref={logRef}
                role="log"
                aria-live="polite"
                aria-label="Conversation"
                className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3"
              >
                {messages.length === 0 ? (
                  <div className="flex flex-col gap-3 text-sm">
                    <div className="font-medium">{intro.title}</div>
                    {intro.lines.map((line) => (
                      <div key={line} className="text-muted-foreground leading-relaxed">
                        {line}
                      </div>
                    ))}
                    {intro.examples.length > 0 ? (
                      <div className="flex flex-col gap-1.5">
                        <div className="text-muted-foreground text-xs font-medium">Try asking</div>
                        {intro.examples.map((example) => (
                          <button
                            key={example.question}
                            type="button"
                            onClick={() => send(example.question)}
                            className="rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                          >
                            {example.question}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  messages.map((message, index) => (
                    <MessageBubble
                      key={index}
                      message={message}
                      onOpenSettings={() => setAssistantView("settings")}
                    />
                  ))
                )}
                {pending ? (
                  <div
                    className="mr-8 flex items-center gap-2 text-xs text-muted-foreground"
                    role="status"
                  >
                    <span className="flex gap-1" aria-hidden>
                      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.2s]" />
                      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.1s]" />
                      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
                    </span>
                    {ASSISTANT_DISPLAY_NAME} is looking it up…
                  </div>
                ) : null}
              </div>

              <form
                className="border-t border-border p-2.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  send(input);
                }}
              >
                <div className="flex items-end gap-2">
                  <Textarea
                    ref={inputRef}
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={onComposerKey}
                    maxLength={2000}
                    rows={1}
                    aria-label={`Ask ${ASSISTANT_DISPLAY_NAME} a question`}
                    placeholder={
                      published?.materialScope
                        ? "Ask about this course or EduAI…"
                        : "Ask how to do something…"
                    }
                    className="max-h-32 min-h-10 resize-none text-sm"
                  />
                  <Button
                    type="submit"
                    size="icon"
                    className="size-10 shrink-0"
                    aria-label="Send question"
                    disabled={!input.trim() || pending}
                  >
                    <IconArrowUp className="size-4" aria-hidden />
                  </Button>
                </div>
                <div className="mt-1.5 px-1 text-[0.6875rem] text-muted-foreground">
                  Answers come only from the EduAI guide
                  {published?.materialScope ? " and this course's materials" : ""}. They can be
                  wrong.
                </div>
              </form>
            </>
          )}
        </section>
      ) : null}
    </>
  );
}
