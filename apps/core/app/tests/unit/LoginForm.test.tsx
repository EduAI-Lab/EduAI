import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoginForm } from "~/components/login-form";

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("LoginForm — rendering", () => {
  it("renders an email input with type=\"email\"", () => {
    render(<LoginForm />);
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
  });

  it("renders a password input with type=\"password\"", () => {
    render(<LoginForm />);
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
  });

  it("renders the submit button with the text \"Login\"", () => {
    render(<LoginForm />);
    expect(screen.getByRole("button", { name: "Login" })).toBeInTheDocument();
  });

  it("renders a \"Login with GitHub\" button", () => {
    render(<LoginForm />);
    expect(screen.getByRole("button", { name: /login with github/i })).toBeInTheDocument();
  });

  it("renders a link to /auth/register", () => {
    render(<LoginForm />);
    const link = screen.getByRole("link", { name: /sign up/i });
    expect(link).toHaveAttribute("href", "/auth/register");
  });
});

// ---------------------------------------------------------------------------
// Field errors
// ---------------------------------------------------------------------------

describe("LoginForm — field errors", () => {
  it("displays the email error message when fieldErrors.email is set", () => {
    render(<LoginForm fieldErrors={{ email: "Invalid email address" }} />);
    expect(screen.getByText("Invalid email address")).toBeInTheDocument();
  });

  it("applies the error border class to the email input when fieldErrors.email is set", () => {
    render(<LoginForm fieldErrors={{ email: "Invalid email address" }} />);
    expect(screen.getByLabelText("Email")).toHaveClass("border-red-300");
  });

  it("displays the password error message when fieldErrors.password is set", () => {
    render(<LoginForm fieldErrors={{ password: "Password is required" }} />);
    expect(screen.getByText("Password is required")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Loading state
// ---------------------------------------------------------------------------

describe("LoginForm — loading state", () => {
  it("disables the email input when isLoading is true", () => {
    render(<LoginForm isLoading />);
    expect(screen.getByLabelText("Email")).toBeDisabled();
  });

  it("disables the password input when isLoading is true", () => {
    render(<LoginForm isLoading />);
    expect(screen.getByLabelText("Password")).toBeDisabled();
  });

  it("disables the submit button when isLoading is true", () => {
    render(<LoginForm isLoading />);
    expect(screen.getByRole("button", { name: /signing in/i })).toBeDisabled();
  });

  it("changes the submit button text to \"Signing in...\" when isLoading is true", () => {
    render(<LoginForm isLoading />);
    expect(screen.getByRole("button", { name: "Signing in..." })).toBeInTheDocument();
  });
});
