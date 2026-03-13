import type { Session } from "./server";
import { auth } from "./server";
import prisma from "../prisma.server";

type GuardResult = {
  response: Response | null;
  session: SessionWithUser | null;
};

export type SessionWithUser = Pick<Session, "user">;
export type RequestAuthType = "api-key" | "oauth-bearer" | "session-cookie" | null;

type RequestAuthContext = {
  session: SessionWithUser | null;
  authType: RequestAuthType;
};

function getBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return null;

  const [scheme, token, ...rest] = authHeader.trim().split(/\s+/);
  if (rest.length > 0) return null;
  if (!scheme || scheme.toLowerCase() !== "bearer") return null;
  if (!token) return null;
  return token;
}

async function resolveOAuthBearerSession(request: Request): Promise<SessionWithUser | null> {
  const bearerToken = getBearerToken(request);
  if (!bearerToken) {
    return null;
  }

  const userInfoUrl = new URL("/api/auth/oauth2/userinfo", request.url);
  const userInfoRequest = new Request(userInfoUrl, {
    method: "GET",
    headers: {
      authorization: `Bearer ${bearerToken}`,
      accept: "application/json",
    },
  });

  try {
    const userInfoResponse = await auth.handler(userInfoRequest);
    if (userInfoResponse.ok) {
      const payload = await userInfoResponse.json().catch(() => null);
      const userId = typeof payload?.sub === "string" ? payload.sub : null;

      if (userId) {
        const user = await prisma.user.findUnique({
          where: { id: userId },
        });

        if (user) {
          return {
            user: {
              id: user.id,
              email: user.email,
              name: user.name,
              image: user.image,
              emailVerified: user.emailVerified,
              createdAt: user.createdAt,
              updatedAt: user.updatedAt,
              role: user.role,
              isActive: user.isActive,
            } as Session["user"],
          };
        }
      }
    }
  } catch {
    // Fall back to direct OAuth access-token lookup below.
  }

  const accessToken = await (prisma as any).oauthAccessToken.findUnique({
    where: { token: bearerToken },
    include: { user: true },
  });

  if (!accessToken?.user || accessToken.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  return {
    user: {
      id: accessToken.user.id,
      email: accessToken.user.email,
      name: accessToken.user.name,
      image: accessToken.user.image,
      emailVerified: accessToken.user.emailVerified,
      createdAt: accessToken.user.createdAt,
      updatedAt: accessToken.user.updatedAt,
      role: accessToken.user.role,
      isActive: accessToken.user.isActive,
    } as Session["user"],
  };
}

/**
 * Enforce: if request includes `x-api-key`, only ADMIN users may proceed.
 * Returns `{ response, session }` so callers can reuse the fetched session.
 */
export async function enforceAdminIfApiKey(request: Request): Promise<GuardResult> {
  const apiKeyHeader = request.headers.get("x-api-key");
  if (!apiKeyHeader) {
    return { response: null, session: null };
  }

  const session = await auth.api.getSession(request);
  if (!session?.user || session.user.role !== "ADMIN") {
    return {
      response: new Response(
        JSON.stringify({ error: "Forbidden: x-api-key access restricted to admin users" }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }
      ),
      session: session?.user ? { user: session.user } : null,
    };
  }

  return { response: null, session: { user: session.user } };
}

export async function resolveRequestAuth(
  request: Request,
  options: { preloadedSession?: SessionWithUser | null } = {},
): Promise<RequestAuthContext> {
  if (options.preloadedSession?.user) {
    return { session: options.preloadedSession, authType: "api-key" };
  }

  const bearerSession = await resolveOAuthBearerSession(request);
  if (bearerSession?.user) {
    return { session: bearerSession, authType: "oauth-bearer" };
  }

  const cookieSession = await auth.api.getSession(request);
  if (!cookieSession?.user) {
    return { session: null, authType: null };
  }

  return {
    session: { user: cookieSession.user },
    authType: "session-cookie",
  };
}
