/**
 * Unit tests for `App` (#1546): route wiring, including the legacy-URL
 * redirect components (`/home`, `/study`, `/assessment-variant`). Every page
 * is lazy-loaded and mocked to a marker div; App's internal `BrowserRouter`
 * reads real browser history, so each case drives navigation via
 * `window.history.pushState` before rendering.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Outlet } from "react-router";

vi.mock("@eduai/ui", () => ({
  Toaster: () => <div data-testid="toaster" />,
  ThemeProvider: ({ children }: any) => <>{children}</>,
  ThemeSyncInitializer: () => null,
}));

vi.mock("@/contexts/AuthContext", () => ({
  AuthProvider: ({ children }: any) => <>{children}</>,
}));
vi.mock("@/components/auth/QmAppGate", () => ({
  QmAppGate: ({ children }: any) => <>{children}</>,
}));
vi.mock("@/components/layout/QmAppLayout", () => ({
  QmAppLayout: () => (
    <div data-testid="qm-app-layout">
      <Outlet />
    </div>
  ),
}));
vi.mock("@/contexts/GuidedTourContext", () => ({
  GuidedTourProvider: ({ children }: any) => <>{children}</>,
}));
vi.mock("@/contexts/BugReportContext", () => ({
  BugReportProvider: ({ children }: any) => <>{children}</>,
}));

function pageMock(name: string) {
  return { default: () => <div data-testid={name}>{name}</div> };
}
vi.mock("@/pages/DashboardPage", () => pageMock("dashboard-page"));
vi.mock("@/pages/QuestionBankPage", () => pageMock("question-bank-page"));
vi.mock("@/pages/SettingsPage", () => pageMock("settings-page"));
vi.mock("@/pages/AssessmentBuilderPage", () => pageMock("assessment-builder-page"));
vi.mock("@/pages/CourseSelectionPage", () => ({
  CourseSelectionPage: () => <div data-testid="course-selection-page" />,
}));
vi.mock("@/pages/CourseDetailPage", () => ({
  CourseDetailPage: () => <div data-testid="course-detail-page" />,
}));
vi.mock("@/pages/QuestionComposerPage", () => ({
  QuestionComposerPage: () => <div data-testid="question-composer-page" />,
}));
vi.mock("@/pages/ApiTestPage", () => ({ ApiTestPage: () => <div data-testid="api-test-page" /> }));
vi.mock("@/pages/HelpPage", () => ({ HelpPage: () => <div data-testid="help-page" /> }));
vi.mock("@/pages/BugReportsAdminPage", () => ({
  BugReportsAdminPage: () => <div data-testid="bug-reports-admin-page" />,
}));
vi.mock("@/pages/AssessmentVariantPage", () => ({
  AssessmentVariantPage: () => <div data-testid="assessment-variant-page" />,
}));
vi.mock("@/pages/BankDetailPage", () => pageMock("bank-detail-page"));

import App from "@/App";

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
});

describe("App routing", () => {
  it("redirects the root path to /dashboard", async () => {
    window.history.pushState({}, "", "/");
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("dashboard-page")).toBeInTheDocument());
  });

  it("renders the dashboard route inside the layout", async () => {
    window.history.pushState({}, "", "/dashboard");
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("qm-app-layout")).toBeInTheDocument());
    expect(screen.getByTestId("dashboard-page")).toBeInTheDocument();
  });

  it("renders the question library route at /library", async () => {
    window.history.pushState({}, "", "/library");
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("question-bank-page")).toBeInTheDocument());
  });

  it("redirects legacy /question-bank to /library", async () => {
    window.history.pushState({}, "", "/question-bank");
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("question-bank-page")).toBeInTheDocument());
  });

  it("redirects legacy /assessments to /courses", async () => {
    window.history.pushState({}, "", "/assessments");
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("course-selection-page")).toBeInTheDocument());
  });

  it("redirects /landing to /dashboard", async () => {
    window.history.pushState({}, "", "/landing");
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("dashboard-page")).toBeInTheDocument());
  });

  it("redirects an unmatched path to /dashboard", async () => {
    window.history.pushState({}, "", "/this-route-does-not-exist");
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("dashboard-page")).toBeInTheDocument());
  });

  describe("/home legacy redirect", () => {
    it("falls back to /courses with no stored preference", async () => {
      window.history.pushState({}, "", "/home");
      render(<App />);
      await waitFor(() => expect(screen.getByTestId("course-selection-page")).toBeInTheDocument());
    });

    it("redirects to the stored course's detail page when a preference exists", async () => {
      localStorage.setItem("home:last-selected-course", "42");
      window.history.pushState({}, "", "/home");
      render(<App />);
      await waitFor(() => expect(screen.getByTestId("course-detail-page")).toBeInTheDocument());
      localStorage.removeItem("home:last-selected-course");
    });

    it("ignores a non-numeric stored preference and falls back to /courses", async () => {
      localStorage.setItem("home:last-selected-course", "not-a-number");
      window.history.pushState({}, "", "/home");
      render(<App />);
      await waitFor(() => expect(screen.getByTestId("course-selection-page")).toBeInTheDocument());
      localStorage.removeItem("home:last-selected-course");
    });
  });

  describe("/study legacy redirect", () => {
    it("redirects to the nested variant route when both ids are present", async () => {
      window.history.pushState({}, "", "/study?courseId=3&baselineAssessmentId=9");
      render(<App />);
      await waitFor(() =>
        expect(screen.getByTestId("assessment-variant-page")).toBeInTheDocument(),
      );
    });

    it("redirects to the course's variants route when only courseId is present", async () => {
      window.history.pushState({}, "", "/study?courseId=3");
      render(<App />);
      await waitFor(() =>
        expect(screen.getByTestId("assessment-variant-page")).toBeInTheDocument(),
      );
    });

    it("falls back to /courses when neither id is present", async () => {
      window.history.pushState({}, "", "/study");
      render(<App />);
      await waitFor(() => expect(screen.getByTestId("course-selection-page")).toBeInTheDocument());
    });
  });

  describe("/assessment-variant legacy redirect", () => {
    it("redirects to the nested variant route when both ids are present", async () => {
      window.history.pushState({}, "", "/assessment-variant?courseId=3&baselineAssessmentId=9");
      render(<App />);
      await waitFor(() =>
        expect(screen.getByTestId("assessment-variant-page")).toBeInTheDocument(),
      );
    });

    it("redirects to the course's variants route when only courseId is present", async () => {
      window.history.pushState({}, "", "/assessment-variant?courseId=3");
      render(<App />);
      await waitFor(() =>
        expect(screen.getByTestId("assessment-variant-page")).toBeInTheDocument(),
      );
    });

    it("falls back to /courses when neither id is present", async () => {
      window.history.pushState({}, "", "/assessment-variant");
      render(<App />);
      await waitFor(() => expect(screen.getByTestId("course-selection-page")).toBeInTheDocument());
    });
  });
});
