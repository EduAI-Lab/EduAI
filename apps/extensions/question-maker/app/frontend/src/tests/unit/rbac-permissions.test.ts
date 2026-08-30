import { describe, expect, it } from "vitest";
import {
  canApproveVariant,
  canCreateQuestion,
  canDeleteVariant,
  canEditDraftVariant,
  canEditQuestionMetadata,
  canExportAssessment,
  canLinkCourse,
  canManageAssessment,
  canManageCanvasIntegration,
  canRunAiReview,
  canTriageBugReports,
  canUseVariantWorkflow,
  canViewAssessment,
  resolvePlatformCourseAccess,
} from "@/lib/rbac";

describe("QM RBAC permissions", () => {
  const admin = { id: "a1", role: "ADMIN" };
  const unitAdmin = { id: "u1", role: "UNIT_ADMIN", authorizedUnits: ["COSC"] };
  const instructor = { id: "i1", role: "INSTRUCTOR" };

  it("resolves platform course access by role", () => {
    expect(resolvePlatformCourseAccess(admin)).toBe("admin");
    expect(resolvePlatformCourseAccess(unitAdmin)).toBe("unit");
    expect(resolvePlatformCourseAccess(instructor)).toBe("instructor");
  });

  it("allows authoring roles to create questions", () => {
    expect(canCreateQuestion(admin)).toBe(true);
    expect(canCreateQuestion(unitAdmin)).toBe(true);
    expect(canCreateQuestion(instructor)).toBe(true);
  });

  it("restricts variant approval to instructor and up", () => {
    expect(canApproveVariant(admin)).toBe(true);
    expect(canApproveVariant(unitAdmin)).toBe(true);
    expect(canApproveVariant(instructor)).toBe(true);
    expect(canApproveVariant(instructor, "ta")).toBe(false);
  });

  it("restricts assessment writes to instructor and up", () => {
    expect(canManageAssessment(admin)).toBe(true);
    expect(canManageAssessment(unitAdmin)).toBe(true);
    expect(canManageAssessment(instructor)).toBe(true);
    expect(canManageAssessment(instructor, "ta")).toBe(false);
  });

  it("allows only ADMIN to triage bug reports", () => {
    expect(canTriageBugReports(admin)).toBe(true);
    expect(canTriageBugReports(unitAdmin)).toBe(false);
    expect(canTriageBugReports(instructor)).toBe(false);
  });

  it("denies authoring when course access is null", () => {
    expect(canCreateQuestion(instructor, null)).toBe(false);
    expect(canManageAssessment(instructor, null)).toBe(false);
  });

  it("allows TA to view assessments but not manage them", () => {
    expect(canViewAssessment(instructor, "ta")).toBe(true);
    expect(canManageAssessment(instructor, "ta")).toBe(false);
    expect(canApproveVariant(instructor, "ta")).toBe(false);
  });

  it("allows platform roles to link courses from the course picker", () => {
    expect(canLinkCourse(admin)).toBe(true);
    expect(canLinkCourse(unitAdmin)).toBe(true);
    expect(canLinkCourse(instructor)).toBe(true);
    expect(canLinkCourse(null)).toBe(false);
  });

  describe("canEditQuestionMetadata / canEditDraftVariant / canDeleteVariant", () => {
    const ta = { id: "t1", role: "INSTRUCTOR" };

    it("lets admin, unit, and instructor edit regardless of ownership", () => {
      expect(canEditQuestionMetadata(admin, "admin")).toBe(true);
      expect(canEditQuestionMetadata(unitAdmin, "unit")).toBe(true);
      expect(canEditQuestionMetadata(instructor, "instructor")).toBe(true);
    });

    it("lets a TA edit only their own resource", () => {
      expect(canEditQuestionMetadata(ta, "ta", { createdBy: "t1" })).toBe(true);
      expect(canEditQuestionMetadata(ta, "ta", { createdBy: "other" })).toBe(false);
      expect(canEditQuestionMetadata(ta, "ta")).toBe(false);
    });

    it("denies edit when access is null or unrecognized", () => {
      expect(canEditQuestionMetadata(ta, null)).toBe(false);
    });

    it("mirrors the metadata rule for draft-variant edit and delete", () => {
      expect(canEditDraftVariant(admin, "admin")).toBe(true);
      expect(canEditDraftVariant(ta, "ta", { createdBy: "t1" })).toBe(true);
      expect(canDeleteVariant(admin, "admin")).toBe(true);
      expect(canDeleteVariant(ta, "ta", { createdBy: "other" })).toBe(false);
    });
  });

  describe("assessment export / AI review / variant workflow / canvas", () => {
    it("follows the same authoring-access rule as canManageAssessment", () => {
      expect(canExportAssessment(instructor)).toBe(true);
      expect(canExportAssessment(instructor, "ta")).toBe(false);
      expect(canRunAiReview(admin)).toBe(true);
      expect(canRunAiReview(instructor, "ta")).toBe(false);
      expect(canUseVariantWorkflow(unitAdmin)).toBe(true);
      expect(canUseVariantWorkflow(instructor, "ta")).toBe(false);
    });

    it("restricts Canvas integration management to authoring roles", () => {
      expect(canManageCanvasIntegration(admin)).toBe(true);
      expect(canManageCanvasIntegration(instructor)).toBe(true);
      expect(canManageCanvasIntegration(instructor, "ta")).toBe(false);
      expect(canManageCanvasIntegration(null)).toBe(false);
    });
  });
});
