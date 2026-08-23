import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";
import { BASE_URL } from "../lib/config.js";

// Verifies the sliding-window limiter in app/lib/auth/rate-limit.server.ts
// (default 300 req/60s per identity, SESSION_VALIDATE_RATE_LIMIT) actually
// engages under load, and that it keys per client rather than globally.
//
// POST /api/sessions/validate now rejects missing service auth first and
// bounds that invalid-auth bucket to 1 request, so an unauthenticated burst
// 429s on request 2 and never reaches the 300 limiter. This scenario sends
// Authorization: Bearer $EDUAI_API_KEY and isolates clients with
// X-EduAI-Client-IP (the identity the route trusts after a valid key).

export const rateLimitTriggered = new Counter("eduai_rate_limit_429s");
export const rateLimitIsolationOk = new Counter("eduai_rate_limit_isolation_ok");

const ATTACKER_IP = "203.0.113.50";
const BYSTANDER_IP = "203.0.113.99";
const LIMIT = Number(__ENV.SESSION_VALIDATE_RATE_LIMIT || 300);
const BURST = LIMIT + 20;
const SERVICE_KEY = __ENV.EDUAI_API_KEY || "loadtest-service-key";

function validateHeaders(clientIp) {
  return {
    Authorization: `Bearer ${SERVICE_KEY}`,
    "X-EduAI-Client-IP": clientIp,
    "X-Forwarded-For": clientIp,
  };
}

export function rateLimitCheck() {
  let got429 = false;

  for (let i = 0; i < BURST; i++) {
    const res = http.post(`${BASE_URL}/api/sessions/validate`, null, {
      headers: validateHeaders(ATTACKER_IP),
      tags: { name: "sessions-validate-burst" },
    });
    if (res.status === 429) {
      got429 = true;
      rateLimitTriggered.add(1);
    }
  }

  check(null, {
    [`rate limit engaged within ${BURST} requests (limit=${LIMIT})`]: () => got429,
  });

  // Valid service key, no session: the intended unauthenticated response is
  // 401, not "anything except 429".
  const bystanderRes = http.post(`${BASE_URL}/api/sessions/validate`, null, {
    headers: validateHeaders(BYSTANDER_IP),
    tags: { name: "sessions-validate-bystander" },
  });
  const isolated = check(bystanderRes, {
    "other IPs get unauthenticated 401, not the attacker's 429": (r) => r.status === 401,
  });
  if (isolated) rateLimitIsolationOk.add(1);
}
