import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { login } from '../lib/auth.js';
import { BASE_URL, COURSE_CODE, MODEL_ID, CHAT_MESSAGES } from '../lib/config.js';

// Custom metrics surfaced in the k6 summary and the Grafana dashboard —
// http_req_duration alone mixes page loads and long-running chat streams,
// which hides both signals.
export const pageLoadDuration = new Trend('eduai_page_load_duration', true);
export const chatStreamDuration = new Trend('eduai_chat_stream_duration', true);
export const chatSuccessRate = new Rate('eduai_chat_success');

function randomMessage() {
  return CHAT_MESSAGES[Math.floor(Math.random() * CHAT_MESSAGES.length)];
}

/**
 * One simulated user turn: load the dashboard (as a real session would after
 * login), then send one chat message and wait for the full stream — this is
 * the read+write pair that dominates real traffic on this platform.
 */
export function chatFlow() {
  if (!login()) {
    // Never hot-loop retry a failed login — that's a self-inflicted request
    // storm against the auth endpoint, not a realistic user or a useful
    // signal. Back off like a real client would and let the next iteration
    // try again.
    sleep(2);
    return;
  }

  const dashboardStart = Date.now();
  const dashboardRes = http.get(`${BASE_URL}/dashboard`, { tags: { name: 'dashboard' } });
  pageLoadDuration.add(Date.now() - dashboardStart);
  check(dashboardRes, { 'dashboard loaded': (r) => r.status === 200 });

  sleep(Math.random() * 1.5 + 0.5); // think time — a human reads before typing

  const chatStart = Date.now();
  const chatRes = http.post(
    `${BASE_URL}/api/chat`,
    JSON.stringify({
      messages: [
        {
          id: `${__VU}-${__ITER}-${Date.now()}`,
          role: 'user',
          content: randomMessage(),
        },
      ],
      model: MODEL_ID,
      apiKeys: {},
      courseCode: COURSE_CODE,
      streaming: true,
    }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'chat' },
      timeout: '60s',
    },
  );
  chatStreamDuration.add(Date.now() - chatStart);

  const ok = check(chatRes, {
    'chat responded 200': (r) => r.status === 200,
    'chat body non-empty': (r) => (r.body || '').length > 0,
  });
  chatSuccessRate.add(ok);
  if (!ok) {
    console.error(`[chat] VU ${__VU} got ${chatRes.status}: ${(chatRes.body || '').slice(0, 200)}`);
  }

  sleep(Math.random() * 2 + 1); // think time before the next turn
}
