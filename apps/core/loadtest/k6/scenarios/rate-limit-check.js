import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";
import { BASE_URL } from "../lib/config.js";

// Verifies the sliding-window limiter in app/lib/auth/rate-limit.server.ts
// (default 300 req/60s per IP, SESSION_VALIDATE_RATE_LIMIT) actually engages
// under load, and that it keys per-IP rather than globally — one noisy
// client must not lock out everyone else. The route checks the rate limit
// before auth, so this runs unauthenticated on purpose.

export const rateLimitTriggered = new Counter("eduai_rate_limit_429s");
export const rateLimitIsolationOk = new Counter("eduai_rate_limit_isolation_ok");

const ATTACKER_IP = "203.0.113.50";
const BYSTANDER_IP = "203.0.113.99";
const LIMIT = Number(__ENV.SESSION_VALIDATE_RATE_LIMIT || 300);
const BURST = LIMIT + 20;

export function rateLimitCheck() {
  let got429 = false;

  for (let i = 0; i < BURST; i++) {
    const res = http.post(`${BASE_URL}/api/sessions/validate`, null, {
      headers: { "X-Forwarded-For": ATTACKER_IP },
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

  // A different IP must be unaffected by the attacker's burst — 401
  // (unauthenticated) is the expected "not rate limited" outcome here, since
  // this scenario never logs in.
  const bystanderRes = http.post(`${BASE_URL}/api/sessions/validate`, null, {
    headers: { "X-Forwarded-For": BYSTANDER_IP },
    tags: { name: "sessions-validate-bystander" },
  });
  const isolated = check(bystanderRes, {
    "other IPs unaffected by one client hitting the limit": (r) => r.status !== 429,
  });
  if (isolated) rateLimitIsolationOk.add(1);
}
