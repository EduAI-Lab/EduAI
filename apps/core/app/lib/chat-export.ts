export type ChatExportMessage = {
  id: string;
  role: string;
  content?: string | null;
  parts?: Array<{ type: string; text?: string; [key: string]: unknown }>;
};

export type ChatExportOptions = {
  title?: string;
  exportedAt?: Date;
  modelName?: string;
};

export type ChatExportDomOptions = ChatExportOptions & {
  pageBackground?: string;
  pageColor?: string;
  pageFontFamily?: string;
};

const INLINABLE_STYLE_PROPS = [
  "display",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "z-index",
  "flex",
  "flex-direction",
  "flex-wrap",
  "flex-shrink",
  "flex-grow",
  "align-items",
  "align-self",
  "justify-content",
  "justify-self",
  "order",
  "gap",
  "grid",
  "grid-template-columns",
  "grid-template-rows",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "width",
  "min-width",
  "max-width",
  "height",
  "min-height",
  "max-height",
  "border",
  "border-top",
  "border-right",
  "border-bottom",
  "border-left",
  "border-radius",
  "border-color",
  "border-width",
  "border-style",
  "background",
  "background-color",
  "background-image",
  "color",
  "font",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-decoration",
  "text-transform",
  "white-space",
  "word-break",
  "overflow-wrap",
  "overflow",
  "overflow-x",
  "overflow-y",
  "opacity",
  "box-shadow",
  "list-style",
  "list-style-type",
  "list-style-position",
  "vertical-align",
  "transform",
];

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

export function defaultExportTitle(messages: ChatExportMessage[]): string {
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

export function sanitizeExportClone(root: HTMLElement): void {
  root.querySelectorAll("[data-chat-export-exclude]").forEach((element) => {
    element.remove();
  });

  root.querySelectorAll("button").forEach((element) => {
    element.remove();
  });

  root.querySelectorAll("script, noscript, iframe").forEach((element) => {
    element.remove();
  });
}

export function expandCollapsiblesInClone(root: HTMLElement): void {
  root.querySelectorAll('[data-slot="collapsible-content"]').forEach((element) => {
    const htmlElement = element as HTMLElement;
    htmlElement.hidden = false;
    htmlElement.removeAttribute("hidden");
    htmlElement.style.setProperty("display", "block", "important");
    htmlElement.style.setProperty("height", "auto", "important");
    htmlElement.style.setProperty("overflow", "visible", "important");
  });

  root.querySelectorAll('[data-slot="collapsible"]').forEach((element) => {
    element.setAttribute("data-state", "open");
  });
}

export function inlineComputedStyles(source: Element, target: Element): void {
  const sourceNodes = [source, ...Array.from(source.querySelectorAll("*"))];
  const targetNodes = [target, ...Array.from(target.querySelectorAll("*"))];

  if (sourceNodes.length !== targetNodes.length) {
    throw new Error("Export clone structure mismatch after sanitization");
  }

  for (let index = 0; index < sourceNodes.length; index += 1) {
    const computed = window.getComputedStyle(sourceNodes[index]);
    const declarations: string[] = [];

    for (const prop of INLINABLE_STYLE_PROPS) {
      const value = computed.getPropertyValue(prop);
      if (!value || value === "initial" || value === "normal") {
        continue;
      }
      declarations.push(`${prop}:${value}`);
    }

    (targetNodes[index] as HTMLElement).setAttribute("style", declarations.join(";"));
  }
}

const EXPORT_BASE_STYLES = `
  * {
    box-sizing: border-box;
  }

  html, body {
    margin: 0;
    min-height: 100%;
  }

  .chat-export-header {
    display: flex;
    align-items: center;
    height: 3.5rem;
    padding: 0 1.5rem;
    border-bottom: 1px solid oklch(0.9037 0 0);
    background: oklch(1 0 0);
  }

  .chat-export-header h1 {
    margin: 0;
    font-size: 1rem;
    font-weight: 500;
  }

  .chat-export-page {
    min-height: calc(100vh - 3.5rem);
    padding: 1.5rem 1rem 3rem;
  }

  .chat-export-meta {
    max-width: 56rem;
    margin: 0 auto 1.5rem;
    color: oklch(0.2435 0 0);
    font-size: 0.75rem;
  }

  .chat-export-content {
    max-width: 56rem;
    margin: 0 auto;
  }

  @media print {
    .chat-export-page {
      min-height: auto;
    }
  }
`;

export function buildChatExportDocument(
  contentHtml: string,
  options: ChatExportDomOptions = {},
): string {
  const exportedAt = options.exportedAt ?? new Date();
  const title = options.title ?? "EduAI Chat";
  const metaParts = [`Exported ${formatExportTimestamp(exportedAt)}`];
  if (options.modelName) {
    metaParts.push(`Model: ${options.modelName}`);
  }

  const pageBackground = options.pageBackground ?? "oklch(1 0 0)";
  const pageColor = options.pageColor ?? "oklch(0.2046 0 0)";
  const pageFontFamily =
    options.pageFontFamily ??
    'Outfit, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600&display=swap"
      rel="stylesheet"
    />
    <style>${EXPORT_BASE_STYLES}</style>
  </head>
  <body style="background:${pageBackground};color:${pageColor};font-family:${pageFontFamily};letter-spacing:0.025em;">
    <header class="chat-export-header">
      <h1>Chat</h1>
    </header>
    <main class="chat-export-page">
      <p class="chat-export-meta">${escapeHtml(metaParts.join(" · "))}</p>
      <div class="chat-export-content">
        ${contentHtml}
      </div>
    </main>
  </body>
</html>`;
}

export function buildChatExportHtmlFromDom(
  container: HTMLElement,
  options: ChatExportDomOptions = {},
): string {
  const clone = container.cloneNode(true) as HTMLElement;
  inlineComputedStyles(container, clone);
  sanitizeExportClone(clone);
  expandCollapsiblesInClone(clone);

  return buildChatExportDocument(clone.innerHTML, options);
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
