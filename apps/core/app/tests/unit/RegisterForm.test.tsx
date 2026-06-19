import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RegisterForm } from "~/components/register-form";

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("RegisterForm — rendering", () => {
  it("renders a name input", () => {
    render(<RegisterForm />);
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });

  it("renders an email input with type=\"email\"", () => {
    render(<RegisterForm />);
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
  });

  it("renders a password input with type=\"password\"", () => {
    render(<RegisterForm />);
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
  });

  it("renders a confirm-password input with type=\"password\"", () => {
    render(<RegisterForm />);
    expect(screen.getByLabelText("Confirm Password")).toHaveAttribute("type", "password");
  });

  it("renders the submit button with the text \"Create account\"", () => {
    render(<RegisterForm />);
    expect(screen.getByRole("button", { name: "Create account" })).toBeInTheDocument();
  });

  it("renders a link to /auth/login", () => {
    render(<RegisterForm />);
    const link = screen.getByRole("link", { name: /login/i });
    expect(link).toHaveAttribute("href", "/auth/login");
  });
});

// ---------------------------------------------------------------------------
// Field errors
// ---------------------------------------------------------------------------

describe("RegisterForm — field errors", () => {
  it("displays and applies error styling for fieldErrors.name", () => {
    render(<RegisterForm fieldErrors={{ name: "Name is required" }} />);
    expect(screen.getByText("Name is required")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveClass("border-destructive");
  });

  it("displays and applies error styling for fieldErrors.email", () => {
    render(<RegisterForm fieldErrors={{ email: "Invalid email" }} />);
    expect(screen.getByText("Invalid email")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveClass("border-destructive");
  });

  it("displays and applies error styling for fieldErrors.password", () => {
    render(<RegisterForm fieldErrors={{ password: "Password too short" }} />);
    expect(screen.getByText("Password too short")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveClass("border-destructive");
  });

  it("displays and applies error styling for fieldErrors.confirmPassword", () => {
    render(<RegisterForm fieldErrors={{ confirmPassword: "Passwords do not match" }} />);
    expect(screen.getByText("Passwords do not match")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm Password")).toHaveClass("border-destructive");
  });
});

// ---------------------------------------------------------------------------
// Loading state
// ---------------------------------------------------------------------------

describe("RegisterForm — loading state", () => {
  it("disables the name input when isLoading is true", () => {
    render(<RegisterForm isLoading />);
    expect(screen.getByLabelText("Name")).toBeDisabled();
  });

  it("disables the email input when isLoading is true", () => {
    render(<RegisterForm isLoading />);
    expect(screen.getByLabelText("Email")).toBeDisabled();
  });

  it("disables the password input when isLoading is true", () => {
    render(<RegisterForm isLoading />);
    expect(screen.getByLabelText("Password")).toBeDisabled();
  });

  it("disables the confirm-password input when isLoading is true", () => {
    render(<RegisterForm isLoading />);
    expect(screen.getByLabelText("Confirm Password")).toBeDisabled();
  });

  it("disables the submit button when isLoading is true", () => {
    render(<RegisterForm isLoading />);
    expect(screen.getByRole("button", { name: /creating account/i })).toBeDisabled();
  });

  it("changes the submit button text to \"Creating account...\" when isLoading is true", () => {
    render(<RegisterForm isLoading />);
    expect(screen.getByRole("button", { name: "Creating account..." })).toBeInTheDocument();
  });
});
