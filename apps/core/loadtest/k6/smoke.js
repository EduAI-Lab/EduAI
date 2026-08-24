// Fast low-VU sanity check — run this before stress-500.js to catch a
// broken script/env in ~30s instead of discovering it 10 minutes into a
// 500-VU ramp.
//
//   k6 run loadtest/k6/smoke.js
import { chatFlow, dashboardOk, dashboardSamples } from "./scenarios/chat-flow.js";
import {
  rateLimitCheck,
  rateLimitTriggered,
  rateLimitIsolationOk,
} from "./scenarios/rate-limit-check.js";

export const options = {
  scenarios: {
    chat_flow: {
      executor: "ramping-vus",
      exec: "chatFlow",
      startVUs: 0,
      stages: [
        { duration: "10s", target: 5 },
        { duration: "20s", target: 10 },
        { duration: "10s", target: 0 },
      ],
      gracefulRampDown: "10s",
    },
    rate_limit_check: {
      executor: "shared-iterations",
      exec: "rateLimitCheck",
      vus: 1,
      iterations: 1,
      startTime: "5s",
    },
  },
  thresholds: {
    checks: ["rate>0.9"],
    eduai_chat_success: ["rate>0.9"],
    eduai_dashboard_ok: ["rate>0.9"],
    eduai_dashboard_samples: ["count>=1"],
    eduai_rate_limit_429s: ["count>=1"],
    eduai_rate_limit_isolation_ok: ["count>=1"],
  },
};

export {
  chatFlow,
  dashboardOk,
  dashboardSamples,
  rateLimitCheck,
  rateLimitTriggered,
  rateLimitIsolationOk,
};
