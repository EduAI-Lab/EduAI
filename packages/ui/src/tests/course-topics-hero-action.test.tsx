import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CourseTopicsHeroAction } from "../course-topics-hero-action";

describe("CourseTopicsHeroAction", () => {
  it("renders nothing when canManage is false", () => {
    const { container } = render(
      <CourseTopicsHeroAction canManage={false} isLinked={false} onCreateTopic={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when isLinked is true and onSync is not provided", () => {
    const { container } = render(
      <CourseTopicsHeroAction canManage={true} isLinked={true} onCreateTopic={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a sync button when isLinked and onSync is provided, and calls onSync on click", async () => {
    const onSync = vi.fn().mockResolvedValue(undefined);
    render(
      <CourseTopicsHeroAction
        canManage={true}
        isLinked={true}
        onSync={onSync}
        onCreateTopic={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", { name: "Sync topics from EduAI" });
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(onSync).toHaveBeenCalledTimes(1);
  });

  it("renders a create-topic button when unlinked", () => {
    render(
      <CourseTopicsHeroAction canManage={true} isLinked={false} onCreateTopic={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Create topic" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sync topics from EduAI" })).not.toBeInTheDocument();
  });

  it("opens the create dialog when the create-topic button is clicked", () => {
    render(
      <CourseTopicsHeroAction canManage={true} isLinked={false} onCreateTopic={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create topic" }));
    expect(screen.getByText("Create Topic")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Topic name")).toBeInTheDocument();
  });

  it("shows a validation error and does not call onCreateTopic when submitting an empty name", async () => {
    const onCreateTopic = vi.fn();
    const onCreateValidationError = vi.fn();
    render(
      <CourseTopicsHeroAction
        canManage={true}
        isLinked={false}
        onCreateTopic={onCreateTopic}
        onCreateValidationError={onCreateValidationError}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create topic" }));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(screen.getByText("Topic name cannot be empty.")).toBeInTheDocument();
    });
    expect(onCreateTopic).not.toHaveBeenCalled();
    expect(onCreateValidationError).toHaveBeenCalledWith("Topic name cannot be empty.");
  });

  it("also validates a whitespace-only name as empty", async () => {
    const onCreateTopic = vi.fn();
    render(
      <CourseTopicsHeroAction canManage={true} isLinked={false} onCreateTopic={onCreateTopic} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create topic" }));
    fireEvent.change(screen.getByPlaceholderText("Topic name"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(screen.getByText("Topic name cannot be empty.")).toBeInTheDocument();
    });
    expect(onCreateTopic).not.toHaveBeenCalled();
  });

  it("calls onCreateTopic with the trimmed name and closes the dialog on success", async () => {
    const onCreateTopic = vi.fn().mockResolvedValue(undefined);
    const onCreateSuccess = vi.fn();
    render(
      <CourseTopicsHeroAction
        canManage={true}
        isLinked={false}
        onCreateTopic={onCreateTopic}
        onCreateSuccess={onCreateSuccess}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create topic" }));
    fireEvent.change(screen.getByPlaceholderText("Topic name"), {
      target: { value: "  Recursion  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(onCreateTopic).toHaveBeenCalledWith("Recursion");
      expect(onCreateSuccess).toHaveBeenCalledWith("Recursion");
    });
    await waitFor(() => {
      expect(screen.queryByText("Create Topic")).not.toBeInTheDocument();
    });
  });

  it("shows an inline error and keeps the dialog open when onCreateTopic rejects", async () => {
    const onCreateTopic = vi.fn().mockRejectedValue(new Error("boom"));
    const onCreateError = vi.fn();
    render(
      <CourseTopicsHeroAction
        canManage={true}
        isLinked={false}
        onCreateTopic={onCreateTopic}
        onCreateError={onCreateError}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create topic" }));
    fireEvent.change(screen.getByPlaceholderText("Topic name"), { target: { value: "Loops" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(screen.getByText("Could not create topic. Try a different name.")).toBeInTheDocument();
    });
    expect(onCreateError).toHaveBeenCalled();
    expect(screen.getByText("Create Topic")).toBeInTheDocument();
  });

  it("does not show an inline error when showInlineCreateError is false", async () => {
    const onCreateTopic = vi.fn().mockRejectedValue(new Error("boom"));
    render(
      <CourseTopicsHeroAction
        canManage={true}
        isLinked={false}
        onCreateTopic={onCreateTopic}
        showInlineCreateError={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create topic" }));
    fireEvent.change(screen.getByPlaceholderText("Topic name"), { target: { value: "Loops" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(onCreateTopic).toHaveBeenCalled();
    });
    expect(
      screen.queryByText("Could not create topic. Try a different name."),
    ).not.toBeInTheDocument();
  });

  it("does not close the dialog via Cancel/backdrop while a create is in flight", async () => {
    let resolveCreate: () => void = () => {};
    const onCreateTopic = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    render(
      <CourseTopicsHeroAction canManage={true} isLinked={false} onCreateTopic={onCreateTopic} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create topic" }));
    fireEvent.change(screen.getByPlaceholderText("Topic name"), { target: { value: "Loops" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    // Cancel button is disabled while creating.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    });

    resolveCreate();
    await waitFor(() => {
      expect(screen.queryByText("Create Topic")).not.toBeInTheDocument();
    });
  });
});
