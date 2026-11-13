import { describe, expect, it } from "vitest";

import { auditActionLabel } from "~/lib/audit-action-labels";

describe("auditActionLabel", () => {
  it("uses the plain-language name for known codes", () => {
    expect(auditActionLabel("USER_ROLE_CHANGED")).toBe("Role changed");
    expect(auditActionLabel("INVITATION_CREATED")).toBe("Invite sent");
  });

  it("falls back to sentence case, keeping acronyms", () => {
    expect(auditActionLabel("COURSE_TA_ASSIGNED")).toBe("Course TA assigned");
    expect(auditActionLabel("AI_MODEL_UPDATED")).toBe("AI model updated");
    expect(auditActionLabel("MATERIAL_UPLOADED")).toBe("Material uploaded");
  });
});
