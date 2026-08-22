import { describe, expect, it } from "vitest";
import {
  canAccessStudentTour,
  canAccessTour,
  canAccessUnitAdminTour,
  resolveSuggestedTourId,
} from "~/lib/tours/tour-storage";

describe("tour access helpers", () => {
  it("allows students on student routes", () => {
    expect(canAccessStudentTour("STUDENT", "/student")).toBe(true);
    expect(canAccessStudentTour("STUDENT", "/student/course/1")).toBe(true);
  });

  it("allows TAs on instructor and student routes", () => {
    expect(canAccessStudentTour("TA", "/instructor")).toBe(true);
    expect(canAccessStudentTour("TA", "/student")).toBe(true);
  });

  it("denies instructors and admins on student and instructor shells", () => {
    expect(canAccessStudentTour("ADMIN", "/student")).toBe(false);
    expect(canAccessStudentTour("INSTRUCTOR", "/student")).toBe(false);
    expect(canAccessStudentTour("UNIT_ADMIN", "/student")).toBe(false);
    expect(canAccessStudentTour("INSTRUCTOR", "/instructor")).toBe(false);
    expect(canAccessStudentTour("ADMIN", "/instructor")).toBe(false);
    expect(canAccessStudentTour("UNIT_ADMIN", "/instructor")).toBe(false);
  });

  it("offers the unit-admin tour only to a unit admin, and only where it runs", () => {
    // The staff tour is a separate tour from the learner-voiced ones — a unit
    // admin is still out of scope for `canAccessStudentTour` (asserted above).
    expect(canAccessUnitAdminTour("UNIT_ADMIN", "/dashboard")).toBe(true);
    expect(canAccessUnitAdminTour("UNIT_ADMIN", "/instructor")).toBe(true);
    expect(canAccessUnitAdminTour("UNIT_ADMIN", "/instructor/courses/1")).toBe(true);
    // Routes the tour never visits — starting it there would yank the reader away.
    expect(canAccessUnitAdminTour("UNIT_ADMIN", "/settings")).toBe(false);
    expect(canAccessUnitAdminTour("UNIT_ADMIN", "/help")).toBe(false);
    // Other roles keep their own answer.
    expect(canAccessUnitAdminTour("INSTRUCTOR", "/dashboard")).toBe(false);
    expect(canAccessUnitAdminTour("ADMIN", "/dashboard")).toBe(false);
  });

  it("canAccessTour is the union the sidebar control gates on", () => {
    expect(canAccessTour("UNIT_ADMIN", "/dashboard")).toBe(true);
    expect(canAccessTour("STUDENT", "/student")).toBe(true);
    expect(canAccessTour("INSTRUCTOR", "/dashboard")).toBe(false);
  });

  it("suggests the unit-admin orientation for a unit admin", () => {
    expect(resolveSuggestedTourId("UNIT_ADMIN", "/dashboard")).toBe("unit-admin-orientation");
    expect(resolveSuggestedTourId("UNIT_ADMIN", "/instructor")).toBe("unit-admin-orientation");
    expect(resolveSuggestedTourId("UNIT_ADMIN", "/settings")).toBe(null);
  });

  it("suggests student-journey for TAs on instructor routes", () => {
    expect(resolveSuggestedTourId("TA", "/instructor")).toBe("student-journey");
  });

  it("suggests lesson help on student lesson routes", () => {
    expect(resolveSuggestedTourId("STUDENT", "/student/lesson/1")).toBe("student-lesson-help");
  });
});
