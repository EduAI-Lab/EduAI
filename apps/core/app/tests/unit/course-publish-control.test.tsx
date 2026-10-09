/**
 * #1939 — publishing from the course page, and self-enrollment links on a draft.
 *
 * A self-enrollment link on a Draft course turns every student away, yet the
 * panel used to call it "Active" and the only publish control lived on the
 * Courses list. These pin the three pieces that close that gap: who may publish
 * (mirroring PATCH /api/courses/:id/publish), the label a draft's link gets, and
 * the confirm-then-publish control itself.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CoursePublishControl } from "~/components/courses/course-publish-control";
import { selfEnrollmentStatusLabel } from "~/components/courses/self-enrollment-draft-notice";
import { resolveManagerViewClientGates } from "~/lib/courses/manager-view-client-gates";
import type { PolicyKey } from "~/lib/policy-flags";
import type { CourseAccess } from "~/lib/rbac/types";

function canPublish(access: CourseAccess, instructorsMayPublish: boolean): boolean {
  const isEnabled = (key: PolicyKey) =>
    key === "instructors.canPublishCourses" ? instructorsMayPublish : false;
  return resolveManagerViewClientGates(access, isEnabled, "user-1").canPublishCourse;
}

describe("canPublishCourse mirrors the publish endpoint", () => {
  it("lets admins and unit admins publish regardless of the instructor policy", () => {
    expect(canPublish("admin", false)).toBe(true);
    expect(canPublish("unit", false)).toBe(true);
  });

  it("lets an instructor publish only when instructors.canPublishCourses is on", () => {
    expect(canPublish("instructor", true)).toBe(true);
    expect(canPublish("instructor", false)).toBe(false);
  });

  it("never lets a TA, a student or an unrelated user publish", () => {
    expect(canPublish("ta", true)).toBe(false);
    expect(canPublish("student", true)).toBe(false);
    expect(canPublish(null, true)).toBe(false);
  });
});

describe("selfEnrollmentStatusLabel", () => {
  it("says an active link on a draft course is waiting for the course to be published", () => {
    expect(selfEnrollmentStatusLabel("ACTIVE", false)).toBe("Waiting for publish");
  });

  it("keeps the plain status once the course is published", () => {
    expect(selfEnrollmentStatusLabel("ACTIVE", true)).toBe("Active");
  });

  it("does not relabel links that are already unusable for another reason", () => {
    expect(selfEnrollmentStatusLabel("REVOKED", false)).toBe("Turned off");
    expect(selfEnrollmentStatusLabel("EXPIRED", false)).toBe("Expired");
  });
});

describe("CoursePublishControl", () => {
  it("publishes a draft only after the confirm dialog, with the Courses-list wording", async () => {
    const onPublishChange = vi.fn(async () => {});
    render(
      <CoursePublishControl
        courseLabel="DATA 301 — Intro to Data Analytics"
        isPublished={false}
        onPublishChange={onPublishChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Publish course" }));
    expect(onPublishChange).not.toHaveBeenCalled();
    expect(
      await screen.findByText('Publish "DATA 301 — Intro to Data Analytics"?'),
    ).toBeInTheDocument();
    expect(screen.getByText("Students will be able to see this course.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(onPublishChange).toHaveBeenCalledWith(true));
  });

  it("unpublishes a published course after warning that students lose access", async () => {
    const onPublishChange = vi.fn(async () => {});
    render(
      <CoursePublishControl
        courseLabel="DATA 301 — Intro to Data Analytics"
        isPublished
        onPublishChange={onPublishChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Unpublish course" }));
    expect(
      await screen.findByText("Students will lose access to this course."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Unpublish" }));
    await waitFor(() => expect(onPublishChange).toHaveBeenCalledWith(false));
  });

  it("says so when the change fails instead of failing silently", async () => {
    const onPublishChange = vi.fn(async () => {
      throw new Error("Forbidden");
    });
    render(
      <CoursePublishControl
        courseLabel="DATA 301 — Intro to Data Analytics"
        isPublished={false}
        onPublishChange={onPublishChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Publish course" }));
    fireEvent.click(await screen.findByRole("button", { name: "Publish" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not update the course. Please try again.",
    );
  });
});
