import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChatMessage } from "~/components/chat/chat-message";
import { encodeTextDataUrl } from "~/lib/chat/chat-attachments";

describe("ChatMessage — attachments (#1902)", () => {
  it("shows attachment chips on a user message without dumping the file text", () => {
    render(
      <ChatMessage
        message={{
          id: "u1",
          role: "user",
          content: "Summarise this",
          experimental_attachments: [
            {
              name: "notes.md",
              contentType: "text/plain",
              url: encodeTextDataUrl("SECRET BODY TEXT"),
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Summarise this")).toBeInTheDocument();
    expect(screen.getByText("notes.md")).toBeInTheDocument();
    expect(screen.queryByText(/SECRET BODY TEXT/u)).toBeNull();
  });

  it("renders no chip list when there are no attachments", () => {
    render(<ChatMessage message={{ id: "u1", role: "user", content: "hi" }} />);
    expect(screen.queryByRole("list", { name: /attached files/i })).toBeNull();
  });
});
