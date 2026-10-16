/**
 * Renders an assistant answer from its parsed block tree (#1822). Every leaf is a
 * React text child — there is no `dangerouslySetInnerHTML` anywhere in this
 * component — so markup inside a model answer is shown as inert text.
 */
import { Link } from "react-router";
import { IconFileText } from "@tabler/icons-react";

import { parseAnswer, safeSourceHref, type InlineSpan } from "./answer-blocks";
import type { ThreadSource } from "./assistant-thread";

function Inline({ spans }: { spans: InlineSpan[] }) {
  return (
    <>
      {spans.map((span, index) => {
        if (span.kind === "bold") return <strong key={index}>{span.text}</strong>;
        if (span.kind === "code") {
          return (
            <code key={index} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.8125rem]">
              {span.text}
            </code>
          );
        }
        return <span key={index}>{span.text}</span>;
      })}
    </>
  );
}

export function AnswerView({ answer }: { answer: string }) {
  const blocks = parseAnswer(answer);
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, index) => {
        if (block.kind === "code") {
          return (
            <pre
              key={index}
              className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs leading-relaxed"
            >
              <code>{block.text}</code>
            </pre>
          );
        }
        if (block.kind === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag
              key={index}
              className={`flex flex-col gap-1 pl-5 ${block.ordered ? "list-decimal" : "list-disc"}`}
            >
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <Inline spans={item} />
                </li>
              ))}
            </ListTag>
          );
        }
        return (
          <div key={index}>
            <Inline spans={block.spans} />
          </div>
        );
      })}
    </div>
  );
}

/** Cited pages. A URL that fails re-validation renders as plain text, never an href. */
export function AnswerSources({ sources }: { sources: ThreadSource[] }) {
  if (sources.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-1 border-t border-border/60 pt-2">
      <div className="text-muted-foreground text-[0.6875rem] font-medium uppercase tracking-wide">
        Sources
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {sources.map((source) => {
          const href = safeSourceHref(source.url);
          const content = (
            <>
              <IconFileText className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{source.title}</span>
            </>
          );
          return (
            <li key={`${source.id}-${source.url}`} className="max-w-full">
              {href ? (
                <Link
                  to={href}
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-xs text-foreground transition-colors hover:bg-muted"
                >
                  {content}
                </Link>
              ) : (
                <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
