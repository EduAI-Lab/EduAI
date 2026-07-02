import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatPrivacyNoticeDialog } from "~/components/chat/chat-privacy-notice-dialog";

describe("ChatPrivacyNoticeDialog", () => {
  it("shows privacy copy and calls onAcknowledge", () => {
    const onAcknowledge = vi.fn();
    render(<ChatPrivacyNoticeDialog open onAcknowledge={onAcknowledge} />);

    expect(screen.getByText("Your chat may be reviewed")).toBeInTheDocument();
    expect(
      screen.getByText(/instructor, teaching assistants, and platform admins/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "I understand" }));
    expect(onAcknowledge).toHaveBeenCalledOnce();
  });
});
