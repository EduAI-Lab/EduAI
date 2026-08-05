/**
 * PICT adapter (#1185, census docs/PICT_CENSUS.md § S6): per generated row
 * from tests/models/auth-precedence.cases.json, drives either
 * `enforceAdminIfApiKey` directly (Site=guard) or the composed `GET /api/me`
 * loader (Site=api-me) against tests/models/auth-precedence.oracle.ts.
 *
 * Same mocking convention as guards.server.test.ts (auth/prisma/policy/
 * logging mocked, real guard/route code exercised) — this file specifically
 * targets the cross-site precedence contract the two call sites share.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { enforceAdminIfApiKey } from "~/lib/auth/guards.server";
import { auth } from "~/lib/auth/server";
import { isActiveAdminUser } from "~/lib/api-keys/access.server";
import prisma from "~/lib/prisma.server";
import { loader as apiMeLoader } from "~/routes/api/me";
import authPrecedenceCases from "../../../../../tests/models/auth-precedence.cases.json";
import {
  expectedGuardResult,
  expectedApiMeStatus,
  type AuthPrecedenceRow,
} from "../../../../../tests/models/auth-precedence.oracle";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn(), verifyApiKey: vi.fn() } },
}));
vi.mock("~/lib/api-keys/access.server", () => ({ isActiveAdminUser: vi.fn() }));
vi.mock("~/lib/prisma.server", () => ({ default: { user: { findUnique: vi.fn() } } }));
vi.mock("~/lib/logging.server", () => ({ fireAndForget: vi.fn(), logSecurityEvent: vi.fn() }));

const rows = authPrecedenceCases as AuthPrecedenceRow[];

type MockUser = {
  id: string;
  email: string;
  name: string;
  image: null;
  role: string;
  isActive: boolean;
  emailVerified: boolean;
  authorizedUnits: string[];
  createdAt: Date;
  updatedAt: Date;
};

function mockUser(id: string, role: string, isActive: boolean): MockUser {
  return {
    id,
    email: `${id}@ubc.ca`,
    name: id,
    image: null,
    role,
    isActive,
    emailVerified: true,
    authorizedUnits: [],
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

const KEY_USERS: Record<string, MockUser> = {
  "valid-admin-active": mockUser("key-admin-active", "ADMIN", true),
  "valid-admin-inactive": mockUser("key-admin-inactive", "ADMIN", false),
  "valid-nonadmin": mockUser("key-student", "STUDENT", true),
};

const COOKIE_USERS: Record<string, MockUser> = {
  "admin-active": mockUser("cookie-admin-active", "ADMIN", true),
  "admin-inactive": mockUser("cookie-admin-inactive", "ADMIN", false),
  nonadmin: mockUser("cookie-student", "STUDENT", true),
};

const ALL_USERS = [...Object.values(KEY_USERS), ...Object.values(COOKIE_USERS)];

function setUpMocks(row: AuthPrecedenceRow) {
  vi.mocked(prisma.user.findUnique).mockImplementation((({ where }: any) => {
    return Promise.resolve(ALL_USERS.find((u) => u.id === where.id) ?? null);
  }) as never);
  vi.mocked(isActiveAdminUser).mockImplementation(async (userId) => {
    const user = ALL_USERS.find((u) => u.id === userId);
    return user?.role === "ADMIN" && user.isActive === true;
  });

  if (row.CookieState === "none") {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
  } else {
    const user = COOKIE_USERS[row.CookieState];
    vi.mocked(auth.api.getSession).mockResolvedValue({ user } as never);
  }

  if (row.KeyState === "invalid") {
    vi.mocked(auth.api.verifyApiKey).mockResolvedValue({
      valid: false,
      error: { message: "invalid", code: "KEY_NOT_FOUND" },
      key: null,
    } as never);
  } else if (row.KeyState !== "none") {
    const user = KEY_USERS[row.KeyState];
    vi.mocked(auth.api.verifyApiKey).mockResolvedValue({
      valid: true,
      error: null,
      key: {
        id: `key-for-${user.id}`,
        referenceId: user.id,
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
        expiresAt: null,
      },
    } as never);
  }
}

function makeRequest(row: AuthPrecedenceRow): Request {
  const headers = new Headers();
  if (row.KeyState !== "none") headers.set("x-api-key", "test-key");
  return new Request("http://localhost/api/me", { method: "GET", headers });
}

describe.each(rows.map((row, index) => [index, row] as const))(
  "auth-precedence PICT row #%i",
  (index, row) => {
    beforeEach(() => {
      vi.mocked(auth.api.getSession).mockReset();
      vi.mocked(auth.api.verifyApiKey).mockReset();
      vi.mocked(prisma.user.findUnique).mockReset();
      vi.mocked(isActiveAdminUser).mockReset();
      setUpMocks(row);
    });

    it(`${row.KeyState}/${row.CookieState}/${row.Site} matches oracle`, async () => {
      if (row.Site === "guard") {
        const expected = expectedGuardResult(row);
        const gate = await enforceAdminIfApiKey(makeRequest(row));
        expect(gate.response !== null).toBe(expected.hasResponse);
        if (expected.status !== undefined) expect(gate.response?.status).toBe(expected.status);
        expect(gate.session !== null).toBe(expected.hasSession);
        return;
      }

      const res = await apiMeLoader({ request: makeRequest(row) } as any);
      expect((res as Response).status).toBe(expectedApiMeStatus(row));
    });
  },
);
