import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { useState } from "react";

import { CHAT_MESSAGE_INPUT_ID } from "~/components/assistive/active-highlight";
import { useAssistiveReorientation } from "~/hooks/use-assistive-reorientation";
import * as assistiveEventsClient from "~/lib/assistive-events.client";

function Harness({
  enabled,
  adhdAssist,
  chatId,
  epoch,
}: {
  enabled: boolean;
  adhdAssist: boolean;
  chatId: string | null;
  epoch: number;
}) {
  useAssistiveReorientation({ enabled, adhdAssist, chatId, epoch });
  return (
    <>
      <input id={CHAT_MESSAGE_INPUT_ID} aria-label="Chat message" />
      <button type="button">Assistive toggle</button>
    </>
  );
}

describe("useAssistiveReorientation", () => {
  beforeEach(() => {
    vi.spyOn(assistiveEventsClient, "postAssistiveClientEvent").mockImplementation(
      () => undefined,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records re_orientation on pointerdown", () => {
    render(
      <Harness enabled adhdAssist chatId="chat-1" epoch={1} />,
    );

    window.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));

    expect(assistiveEventsClient.postAssistiveClientEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "re_orientation",
        adhdAssist: true,
        chatId: "chat-1",
      }),
    );
  });

  it("ignores programmatic focusin on the chat composer", () => {
    render(
      <Harness enabled adhdAssist chatId="chat-1" epoch={1} />,
    );

    const input = document.getElementById(CHAT_MESSAGE_INPUT_ID);
    input?.focus();
    input?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

    expect(assistiveEventsClient.postAssistiveClientEvent).not.toHaveBeenCalled();
  });

  it("records re_orientation on focusin to other controls", () => {
    render(
      <Harness enabled adhdAssist={false} chatId={null} epoch={1} />,
    );

    const toggle = document.querySelector("button");
    toggle?.focus();
    toggle?.dispatchEvent(
      new FocusEvent("focusin", { bubbles: true }),
    );

    expect(assistiveEventsClient.postAssistiveClientEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "re_orientation",
        adhdAssist: false,
        chatId: null,
      }),
    );
  });
});

describe("useAssistiveReorientation epoch gating", () => {
  beforeEach(() => {
    vi.spyOn(assistiveEventsClient, "postAssistiveClientEvent").mockImplementation(
      () => undefined,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function EpochHarness() {
    const [epoch, setEpoch] = useState(0);
    useAssistiveReorientation({
      enabled: true,
      adhdAssist: true,
      chatId: null,
      epoch,
    });
    return <button onClick={() => setEpoch((n) => n + 1)}>next epoch</button>;
  }

  it("does not listen when epoch is 0", () => {
    render(<EpochHarness />);
    window.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(assistiveEventsClient.postAssistiveClientEvent).not.toHaveBeenCalled();
  });
});
