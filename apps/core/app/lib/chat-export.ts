import { marked } from "marked";

marked.setOptions({
  gfm: true,
  breaks: true,
});

export type ChatExportMessage = {
  id: string;
  role: string;
  content?: string | null;
  parts?: Array<{ type: string; text?: string; [key: string]: unknown }>;
};

export type ChatExportOptions = {
  messages: ChatExportMessage[];
  title?: string;
  exportedAt?: Date;
  modelName?: string;
  answeredByLabels?: Record<string, string | null | undefined>;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function extractMessageText(message: ChatExportMessage): string {
  const textParts =
    message.parts?.filter((part) => part.type === "text" && typeof part.text === "string") ??
    [];

  if (textParts.length > 0) {
    return textParts.map((part) => part.text).join("\n");
  }

  if (typeof message.content === "string") {
    return message.content;
  }

  return "";
}

function extractToolLabels(message: ChatExportMessage): string[] {
  if (!message.parts?.length) {
    return [];
  }

  const labels: string[] = [];
  for (const part of message.parts) {
    if (part.type === "tool-invocation") {
      const toolName = (part as { toolInvocation?: { toolName?: string } }).toolInvocation
        ?.toolName;
      if (toolName) {
        labels.push(toolName);
      }
      continue;
    }

    if (part.type.startsWith("tool-")) {
      const toolName =
        (part as { toolName?: string }).toolName ?? part.type.replace(/^tool-/, "");
      if (toolName) {
        labels.push(toolName);
      }
    }
  }

  return labels;
}

function defaultExportTitle(messages: ChatExportMessage[]): string {
  const firstUser = messages.find((message) => message.role === "user");
  const text = firstUser ? extractMessageText(firstUser).trim().replace(/\s+/g, " ") : "";
  if (!text) {
    return "EduAI Chat";
  }
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

function formatExportTimestamp(date: Date): string {
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function slugifyFilename(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "chat";
}

export function buildChatExportFilename(options?: {
  title?: string;
  exportedAt?: Date;
}): string {
  const exportedAt = options?.exportedAt ?? new Date();
  const stamp = exportedAt.toISOString().slice(0, 10);
  const slug = slugifyFilename(options?.title ?? "eduai-chat");
  return `eduai-chat-${slug}-${stamp}.html`;
}

const EXPORT_STYLES = `
  :root {
    color-scheme: light;
    --bg: #f8fafc;
    --surface: #ffffff;
    --border: #e2e8f0;
    --text: #0f172a;
    --muted: #64748b;
    --user-bg: #2563eb;
    --user-text: #ffffff;
    --assistant-bg: #f1f5f9;
    --assistant-text: #0f172a;
    --code-bg: #0f172a;
    --code-text: #e2e8f0;
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    line-height: 1.5;
  }

  .export-shell {
    max-width: 48rem;
    margin: 0 auto;
    padding: 2rem 1rem 3rem;
  }

  .export-header {
    margin-bottom: 2rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--border);
  }

  .export-header h1 {
    margin: 0 0 0.5rem;
    font-size: 1.5rem;
    font-weight: 600;
  }

  .export-meta {
    margin: 0;
    color: var(--muted);
    font-size: 0.875rem;
  }

  .messages {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .message-row {
    display: flex;
    gap: 0.75rem;
    align-items: flex-end;
  }

  .message-row.user {
    justify-content: flex-end;
  }

  .avatar {
    flex: 0 0 auto;
    width: 2rem;
    height: 2rem;
    border-radius: 9999px;
    display: grid;
    place-items: center;
    font-size: 0.75rem;
    font-weight: 600;
    background: var(--assistant-bg);
    color: var(--muted);
    border: 1px solid var(--border);
  }

  .message-row.user .avatar {
    order: 2;
  }

  .message-stack {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-width: min(80%, 42rem);
  }

  .message-row.user .message-stack {
    align-items: flex-end;
  }

  .tool-note {
    margin-left: 2.75rem;
    padding: 0.625rem 0.875rem;
    border: 1px dashed var(--border);
    border-radius: 0.5rem;
    background: var(--surface);
    color: var(--muted);
    font-size: 0.8125rem;
  }

  .bubble {
    border-radius: 0.75rem;
    padding: 0.875rem 1rem;
    overflow-wrap: anywhere;
  }

  .bubble.user {
    background: var(--user-bg);
    color: var(--user-text);
    white-space: pre-wrap;
  }

  .bubble.assistant {
    background: var(--assistant-bg);
    color: var(--assistant-text);
  }

  .bubble.assistant :where(p, ul, ol, pre, blockquote, table) {
    margin: 0 0 0.75rem;
  }

  .bubble.assistant :where(p:last-child, ul:last-child, ol:last-child, pre:last-child, blockquote:last-child) {
    margin-bottom: 0;
  }

  .bubble.assistant pre {
    overflow-x: auto;
    padding: 0.875rem 1rem;
    border-radius: 0.5rem;
    background: var(--code-bg);
    color: var(--code-text);
    font-size: 0.8125rem;
  }

  .bubble.assistant code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.875em;
  }

  .bubble.assistant :not(pre) > code {
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    background: rgba(15, 23, 42, 0.08);
  }

  .answered-by {
    margin: 0;
    padding-left: 0.25rem;
    color: var(--muted);
    font-size: 0.75rem;
  }

  @media print {
    body {
      background: white;
    }

    .export-shell {
      max-width: none;
      padding: 0;
    }
  }
`;

function renderMessageHtml(
  message: ChatExportMessage,
  answeredByLabel?: string | null,
): string {
  const text = extractMessageText(message);
  const toolLabels = extractToolLabels(message);
  const isUser = message.role === "user";

  if (isUser) {
    if (!text) {
      return "";
    }

    return `
      <section class="message-row user">
        <div class="message-stack">
          <div class="bubble user">${escapeHtml(text)}</div>
        </div>
        <div class="avatar" aria-hidden="true">U</div>
      </section>
    `;
  }

  const blocks: string[] = [];

  if (toolLabels.length > 0) {
    const toolList = toolLabels.map((label) => escapeHtml(label)).join(", ");
    blocks.push(`<div class="tool-note">Used tools: ${toolList}</div>`);
  }

  if (text) {
    const rendered = marked.parse(text, { async: false }) as string;
    const answeredBy = answeredByLabel
      ? `<p class="answered-by">Answered by ${escapeHtml(answeredByLabel)}</p>`
      : "";

    blocks.push(`
      <section class="message-row assistant">
        <div class="avatar" aria-hidden="true">AI</div>
        <div class="message-stack">
          <div class="bubble assistant">${rendered}</div>
          ${answeredBy}
        </div>
      </section>
    `);
  }

  return blocks.join("\n");
}

export function buildChatExportHtml(options: ChatExportOptions): string {
  const exportedAt = options.exportedAt ?? new Date();
  const title = options.title ?? defaultExportTitle(options.messages);
  const messageHtml = options.messages
    .map((message) =>
      renderMessageHtml(message, options.answeredByLabels?.[message.id]),
    )
    .filter(Boolean)
    .join("\n");

  const metaParts = [`Exported ${formatExportTimestamp(exportedAt)}`];
  if (options.modelName) {
    metaParts.push(`Model: ${options.modelName}`);
  }

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>${EXPORT_STYLES}</style>
  </head>
  <body>
    <div class="export-shell">
      <header class="export-header">
        <h1>${escapeHtml(title)}</h1>
        <p class="export-meta">${escapeHtml(metaParts.join(" · "))}</p>
      </header>
      <main class="messages">
        ${messageHtml || "<p>No messages to export.</p>"}
      </main>
    </div>
  </body>
</html>`;
}

export function downloadChatExportHtml(html: string, filename: string): void {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
