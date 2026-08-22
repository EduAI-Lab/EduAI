/**
 * UNIT_ADMIN fixture builder for the AI Tutor E2E suite.
 *
 * Why a dedicated helper: a unit admin is the only role that cannot be
 * produced by `promoteUser` alone. Platform role UNIT_ADMIN is meaningless
 * without `authorizedUnits` — the department codes that scope every course
 * the admin can see — and `POST /api/e2e/promote` only writes `role`. The
 * units are therefore set through Core's real admin API
 * (`PATCH /api/users/:id`, ADMIN-only), which also validates each code
 * against the `Discipline` table (§541), so the fixture fails loudly if a
 * test asks for a unit that does not exist.
 *
 * What it builds, so a spec can assert on both sides of the unit boundary:
 *   - a UNIT_ADMIN authorized for `units` (default `["COSC"]`);
 *   - an INSTRUCTOR who owns the courses (AI Tutor never creates courses —
 *     Core is the source of truth, so courses are made in Core and mirrored
 *     into AI Tutor via `POST /api/courses/import-external`);
 *   - `course` — a course in the admin's first authorized unit;
 *   - `outOfUnit` — a MATH course the admin must NOT be able to reach.
 *
 * The returned `request` context is re-authenticated as the unit admin, and
 * `instrCtx` stays open so specs can act as the instructor (e.g. publishing
 * the course in Core, which AI Tutor's UI deliberately does not expose).
 * Call `dispose()` when done.
 */
import { expect, type APIRequestContext } from "@playwright/test";
import { AI_TUTOR_API_URL, CORE_URL } from "../../playwright.config";
import { createAdmin, createInstructor, registerUser, signIn, signOut } from "./auth";

const AT = AI_TUTOR_API_URL;
const RUN = Date.now().toString().slice(-5);

/** Department code used for the out-of-unit control course. Must differ from the admin's units. */
export const OUT_OF_UNIT_DEPARTMENT = "MATH";

type PlaywrightRequestFixture = {
  request: { newContext: () => Promise<APIRequestContext> };
};

export interface AtFixtureCourse {
  coreCourseId: string;
  atCourseId: number;
  code: string;
  name: string;
  department: string;
}

export interface UnitAdminFixture {
  email: string;
  password: string;
  name: string;
  id: string;
  /** Department codes written to `authorizedUnits`. */
  units: string[];
  /** Course in `units[0]` — the admin can manage this one. */
  course: AtFixtureCourse;
  /** Course in `OUT_OF_UNIT_DEPARTMENT` — the admin must be denied this one. */
  outOfUnit: AtFixtureCourse;
  /**
   * Second course in `units[0]`, present only with `secondCourse: true`. Its
   * name is deliberately distinct from `course.name` so a <Select> option can
   * be picked by exact title.
   */
  second?: AtFixtureCourse;
  /** Topic name seeded into `course` in Core, present only with `seedTopic: true`. */
  seededTopic?: string;
  /** Authenticated request context for the course-owning INSTRUCTOR. */
  instrCtx: APIRequestContext;
  dispose(): Promise<void>;
}

export interface CreateUnitAdminOptions {
  /** Department codes for `authorizedUnits`. Must exist in Core's `Discipline` table. */
  units?: string[];
  /**
   * Publish the in-unit course in Core before returning. AI Tutor's publish
   * cascade refuses to publish a module whose parent course is unpublished,
   * and course publish state is owned by Core — so any spec that publishes
   * content needs this.
   */
  publishCourse?: boolean;
  /**
   * Mirror a second course in the same unit. Needed by any flow that has to
   * name *another* course the admin can reach — module import's "copy from"
   * picker, the breadcrumb course switcher, the palette's course switch.
   */
  secondCourse?: boolean;
  /**
   * Create a topic on the in-unit course through Core. AI Tutor auto-syncs
   * topics from Core on every `GET /topics`, so this is the only way to get a
   * non-empty topic list onto an imported course.
   *
   * Without it, a course has zero topics and the activity form's topic pickers
   * are disabled for *everyone* (`AddActivityPanel` disables on
   * `topics.length === 0`) — which would make "the picker is disabled" useless
   * as evidence of any role-specific denial.
   */
  seedTopic?: boolean;
}

/**
 * Register a user, promote them to UNIT_ADMIN with `authorizedUnits`, and
 * mirror an in-unit and an out-of-unit course into AI Tutor.
 *
 * `ctx` is left signed in as the unit admin.
 */
export async function createUnitAdmin(
  playwright: PlaywrightRequestFixture,
  ctx: APIRequestContext,
  opts: CreateUnitAdminOptions = {},
): Promise<UnitAdminFixture> {
  const units = opts.units ?? ["COSC"];
  expect(units.length, "createUnitAdmin needs at least one authorized unit").toBeGreaterThan(0);
  expect(units, "the in-unit and out-of-unit departments must differ").not.toContain(
    OUT_OF_UNIT_DEPARTMENT,
  );

  const user = await registerUser(ctx, { name: "E2E Unit Admin", prefix: "unit-admin" });
  const me = await (await ctx.get(`${CORE_URL}/api/me`)).json();

  const adminCtx = await playwright.request.newContext();
  const instrCtx = await playwright.request.newContext();

  let course: AtFixtureCourse;
  let outOfUnit: AtFixtureCourse;
  let second: AtFixtureCourse | undefined;
  let seededTopic: string | undefined;
  try {
    await createAdmin(adminCtx, { prefix: "ua-admin" });

    // `promoteUser` cannot write authorizedUnits — go through the real
    // ADMIN-only user API so the discipline codes are validated too.
    const promoteRes = await adminCtx.patch(`${CORE_URL}/api/users/${me.id}`, {
      data: { role: "UNIT_ADMIN", authorizedUnits: units },
    });
    expect(
      promoteRes.status(),
      `PATCH /api/users/:id → UNIT_ADMIN ${units.join(",")}: ${await promoteRes.text()}`,
    ).toBe(200);

    await createInstructor(instrCtx, { prefix: "ua-instr" });
    const instrMe = await (await instrCtx.get(`${CORE_URL}/api/me`)).json();

    const mirror = async (
      department: string,
      codePrefix: string,
      name = `${department} Unit Admin E2E`,
      topicName?: string,
    ): Promise<AtFixtureCourse> => {
      const coreRes = await adminCtx.post(`${CORE_URL}/api/courses`, {
        form: {
          name,
          code: `${codePrefix}-${RUN}-${Math.floor(Math.random() * 1e4)}`,
          section: "001",
          term: "W1",
          year: "2026",
          startDate: "2026-09-08",
          department,
          instructorUserIds: instrMe.id,
        },
      });
      expect(coreRes.status(), `Core course create (${department}): ${await coreRes.text()}`).toBe(
        201,
      );
      const core = await coreRes.json();

      // Seed the topic BEFORE the import, not after. AI Tutor pulls topics from
      // Core on `GET /topics` but throttles that pull to one per course per
      // `AUTO_SYNC_TTL_MS`, and the import itself performs the first pull — so a
      // topic added afterwards is invisible until the window expires, and every
      // read in a test run serves the empty mirror the import captured.
      if (topicName) {
        const topicRes = await adminCtx.post(`${CORE_URL}/api/courses/${core.id}/topics`, {
          data: { name: topicName },
        });
        expect(topicRes.status(), `Core topic create: ${await topicRes.text()}`).toBe(201);
      }

      // Import is an idempotent ensure: 201 = created here, 200 = the
      // background mirror anchored it first (see at-courses.ts).
      const importRes = await instrCtx.post(`${AT}/api/courses/import-external`, {
        data: { externalCourseId: core.id },
      });
      expect([200, 201]).toContain(importRes.status());
      const at = await importRes.json();

      return {
        coreCourseId: core.id,
        atCourseId: at.id,
        code: core.code,
        name: core.name,
        department,
      };
    };

    if (opts.seedTopic) {
      seededTopic = `E2E Unit Topic ${RUN}-${Math.floor(Math.random() * 1e4)}`;
    }

    course = await mirror(units[0], "UAIN", undefined, seededTopic);
    outOfUnit = await mirror(OUT_OF_UNIT_DEPARTMENT, "UAOUT");

    if (opts.secondCourse) {
      second = await mirror(units[0], "UASRC", `${units[0]} Import Source E2E ${RUN}`);
    }

    if (opts.publishCourse) {
      const pub = await adminCtx.patch(`${CORE_URL}/api/courses/${course.coreCourseId}/publish`);
      expect(pub.status(), `Core publish: ${await pub.text()}`).toBe(200);
    }
  } finally {
    await adminCtx.dispose();
  }

  // Re-authenticate so the caller's context carries the UNIT_ADMIN role.
  await signOut(ctx);
  await signIn(ctx, { email: user.email, password: user.password });

  return {
    ...user,
    id: me.id,
    units,
    course,
    outOfUnit,
    second,
    seededTopic,
    instrCtx,
    dispose: () => instrCtx.dispose(),
  };
}
