import { act, useState } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { PromptInput, PromptInputTextarea } from "../ui/prompt-input";

let lastValue = "";
let rerender: (placeholder: string) => void = () => {};

function Composer({ placeholder: initial }: { placeholder: string }) {
  const [value, setValue] = useState("");
  const [placeholder, setPlaceholder] = useState(initial);
  lastValue = value;
  rerender = setPlaceholder;
  return (
    <PromptInput value={value} onValueChange={setValue}>
      <PromptInputTextarea placeholder={placeholder} />
    </PromptInput>
  );
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = container = undefined;
});

function serverRender() {
  container = document.createElement("div");
  container.innerHTML = renderToString(<Composer placeholder="Ask anything…" />);
  document.body.appendChild(container);
  return container.querySelector("textarea")!;
}

function hydrate() {
  act(() => {
    root = hydrateRoot(container!, <Composer placeholder="Ask anything…" />);
  });
}

describe("PromptInputTextarea hydration (#2186)", () => {
  it("keeps text typed into the server-rendered box before hydration", () => {
    const textarea = serverRender();
    textarea.value = "hello";

    hydrate();
    // The chat screen re-renders right after load (the placeholder picks up the course name);
    // that re-render used to write the empty controlled value back over the typed text.
    act(() => rerender("Ask about COSC 101…"));

    expect(lastValue).toBe("hello");
    expect(textarea.value).toBe("hello");
  });

  it("leaves an untouched box empty", () => {
    const textarea = serverRender();

    hydrate();
    act(() => rerender("Ask about COSC 101…"));

    expect(lastValue).toBe("");
    expect(textarea.value).toBe("");
  });
});
