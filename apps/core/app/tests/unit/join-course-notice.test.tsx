// #1961 — the line a signed-out visitor from a course join link reads on
// sign-in and sign-up: which course, and that a new account joins it on verify.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { JoinCourseNotice } from "~/components/auth/join-course-notice";

const COURSE = { courseCode: "PSYO 121", courseName: "Introductory Psychology" };

describe("JoinCourseNotice (#1961)", () => {
  it("tells a signed-out visitor which course signing in joins, and that sign-up works too", () => {
    render(<JoinCourseNotice {...COURSE} action="sign-in" canRegister />);

    expect(screen.getByText(/Sign in to join/)).toHaveTextContent(
      "Sign in to join PSYO 121 · Introductory Psychology.",
    );
    expect(screen.getByText(/you'll be added once you verify your email/)).toBeInTheDocument();
  });

  it("drops the sign-up hint when public registration is off", () => {
    render(<JoinCourseNotice {...COURSE} action="sign-in" canRegister={false} />);

    expect(screen.getByText(/Sign in to join/)).toBeInTheDocument();
    expect(screen.queryByText(/verify your email/)).toBeNull();
  });

  it("tells a new account it joins the course once the email is verified", () => {
    render(<JoinCourseNotice {...COURSE} action="sign-up" />);

    expect(screen.getByText(/Create your account to join/)).toHaveTextContent(
      "Create your account to join PSYO 121 · Introductory Psychology.",
    );
    expect(
      screen.getByText("You'll be added to the course once you verify your email."),
    ).toBeInTheDocument();
  });
});
