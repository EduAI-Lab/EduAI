// Main entrypoint for issue #919 — browser-level UI stress harness.
// Ramps to 500 concurrent virtual users against a LOCAL, isolated instance
// (see loadtest/README.md). Never point LOADTEST_BASE_URL at a shared or
// live-participant environment.
//
//   k6 run loadtest/k6/stress-500.js
//   k6 run -e LOADTEST_BASE_URL=http://127.0.0.1:4100 loadtest/k6/stress-500.js
//
// For live dashboards: `npm run loadtest:monitoring:up` first, then add
//   --out influxdb=http://127.0.0.1:8086/k6
import { chatFlow } from "./scenarios/chat-flow.js";
import { rateLimitCheck } from "./scenarios/rate-limit-check.js";

export const options = {
  scenarios: {
    chat_flow: {
      executor: "ramping-vus",
      exec: "chatFlow",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 100 },
        { duration: "1m30s", target: 300 },
        { duration: "1m30s", target: 500 },
        { duration: "3m", target: 500 },
        { duration: "1m", target: 0 },
      ],
      gracefulRampDown: "30s",
    },
    // Runs once concurrently with peak load, from a distinct fake IP, to
    // prove the rate limiter still engages correctly while the platform is
    // under the full 500-VU stress test — not just in isolation.
    rate_limit_check: {
      executor: "shared-iterations",
      exec: "rateLimitCheck",
      vus: 1,
      iterations: 1,
      startTime: "3m30s",
    },
  },
  thresholds: {
    // Dashboard/page loads should stay snappy even at 500 concurrent users.
    eduai_page_load_duration: ["p(95)<3000"],
    // Chat is a full LLM round trip (streamed); allow more headroom.
    eduai_chat_stream_duration: ["p(95)<8000"],
    eduai_chat_success: ["rate>0.95"],
    http_req_failed: ["rate<0.05"],
  },
};

export { chatFlow, rateLimitCheck };
