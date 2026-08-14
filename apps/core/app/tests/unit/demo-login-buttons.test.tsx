/**
 * Demo account quick-login buttons (dev/QA only). Each button fills a hidden
 * per-account <form method="post"> and submits it via requestSubmit() — the
 * real login server action handles auth, so what matters here is that
 * clicking a button (a) fires the onSubmit callback before submitting, and
 * (b) submits the right hidden form with the right email/password/redirectTo
 * fields. jsdom/happy-dom don't actually perform a real navigation on
 * requestSubmit(), so we spy on HTMLFormElement.prototype.requestSubmit to
 * observe which form was submitted.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { DemoLoginButtons } from "~/components/auth/demo-login-buttons";

function formFields(form: HTMLFormElement) {
  const fd = new FormData(form);
  return {
    email: fd.get("email"),
    password: fd.get("password"),
    redirectTo: fd.get("redirectTo"),
  };
}

describe("DemoLoginButtons", () => {
  let requestSubmitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    requestSubmitSpy = vi
      .spyOn(HTMLFormElement.prototype, "requestSubmit")
      .mockImplementation(() => {});
  });

  afterEach(() => {
    requestSubmitSpy.mockRestore();
  });

  it("renders one button per demo role", () => {
    render(<DemoLoginButtons redirectTo="/dashboard" />);

    expect(screen.getByTitle("admin@eduai.local")).toBeInTheDocument();
    expect(screen.getByTitle("unitadmin.cosc@eduai.local")).toBeInTheDocument();
    expect(screen.getByTitle("instructor.cs@eduai.local")).toBeInTheDocument();
    expect(screen.getByTitle("ta.cs@eduai.local")).toBeInTheDocument();
    expect(screen.getByTitle("student1@eduai.local")).toBeInTheDocument();
  });

  it("submits the matching hidden form with email/password/redirectTo when clicked", () => {
    render(<DemoLoginButtons redirectTo="/courses" />);

    fireEvent.click(screen.getByTitle("instructor.cs@eduai.local"));

    expect(requestSubmitSpy).toHaveBeenCalledTimes(1);
    const submittedForm = requestSubmitSpy.mock.instances[0] as HTMLFormElement;
    expect(formFields(submittedForm)).toEqual({
      email: "instructor.cs@eduai.local",
      password: "EduAI2026!",
      redirectTo: "/courses",
    });
  });

  it("calls onSubmit before submitting the form", () => {
    const calls: string[] = [];
    const onSubmit = vi.fn(() => calls.push("onSubmit"));
    requestSubmitSpy.mockImplementation(function (this: HTMLFormElement) {
      calls.push("requestSubmit");
    });

    render(<DemoLoginButtons redirectTo="/dashboard" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByTitle("student1@eduai.local"));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["onSubmit", "requestSubmit"]);
  });

  it("works without an onSubmit prop (optional callback)", () => {
    render(<DemoLoginButtons redirectTo="/dashboard" />);
    expect(() => fireEvent.click(screen.getByTitle("admin@eduai.local"))).not.toThrow();
    expect(requestSubmitSpy).toHaveBeenCalledTimes(1);
  });

  it("applies hover styling on mouse enter/leave without throwing", () => {
    render(<DemoLoginButtons redirectTo="/dashboard" />);
    const button = screen.getByTitle("admin@eduai.local");

    fireEvent.mouseEnter(button);
    expect(button.style.borderColor).toBe("var(--secondary)");
    expect(button.style.background).toBe("var(--accent)");

    fireEvent.mouseLeave(button);
    expect(button.style.borderColor).toBe("var(--border)");
    expect(button.style.background).toBe("var(--muted)");
  });
});
