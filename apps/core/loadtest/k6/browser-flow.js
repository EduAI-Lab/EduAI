// True browser-level scenario — drives real Chromium through the actual UI
// (login form, dashboard, chat page), unlike stress-500.js which replays the
// HTTP calls a browser would make. This is what issue #919 means by
// "browser-level ... not just the API": bugs in client JS, real render cost,
// real DOM event handling.
//
// Deliberately run at a MUCH lower VU count than the 500-VU HTTP test — each
// VU here is a full headless Chromium process (~100-300MB RAM), so 500
// concurrent real browsers is not feasible on a laptop. Run this as its own
// `k6 run` invocation, separate from stress-500.js:
//
//   k6 run loadtest/k6/browser-flow.js
//   K6_BROWSER_HEADLESS=false k6 run loadtest/k6/browser-flow.js   # watch it
import { browser } from 'k6/browser';
import { check } from 'k6';
import { BASE_URL, DEMO_PASSWORD, COURSE_CODE, studentForVU } from './lib/config.js';

export const options = {
  scenarios: {
    browser_chat: {
      executor: 'ramping-vus',
      exec: 'browserChatFlow',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 5 },
        { duration: '40s', target: Number(__ENV.BROWSER_VUS || 20) },
        { duration: '1m', target: Number(__ENV.BROWSER_VUS || 20) },
        { duration: '20s', target: 0 },
      ],
      options: {
        browser: { type: 'chromium' },
      },
    },
  },
  thresholds: {
    checks: ['rate>0.9'],
  },
};

export async function browserChatFlow() {
  const page = await browser.newPage();
  const email = studentForVU(__VU);

  try {
    await page.goto(`${BASE_URL}/auth/login`, { waitUntil: 'networkidle' });

    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(DEMO_PASSWORD);
    await Promise.all([
      page.waitForNavigation(),
      page.locator('button[type="submit"]').click(),
    ]);

    check(page, {
      'left the login page after submit': (p) => !p.url().includes('/auth/login'),
    });

    await page.goto(`${BASE_URL}/chat?courseCode=${encodeURIComponent(COURSE_CODE)}`, {
      waitUntil: 'networkidle',
    });

    // First-visit disclaimer modal — not always present (already dismissed
    // for this browser context), so don't fail the run if it's absent.
    const understandBtn = page.locator('button:has-text("I understand")');
    if (await understandBtn.count() > 0) {
      await understandBtn.click();
    }

    const input = page.locator('#chat-message-input');
    await input.waitFor({ state: 'visible', timeout: 10000 });
    await input.fill('Can you summarize the last lecture in one paragraph?');
    await page.locator('button:has-text("Send message")').click();

    // Wait for the mock LLM's known canned reply to render — proves the full
    // round trip (client fetch -> /api/chat -> mock stream -> DOM update)
    // works under concurrent browser load. Matching on real response text
    // avoids depending on the chat UI's internal DOM structure/class names.
    const appeared = await page
      .locator('text=concise answer based on the course material')
      .waitFor({ state: 'visible', timeout: 20000 })
      .then(() => true)
      .catch(() => false);

    check(page, { 'assistant response rendered': () => appeared });
  } finally {
    await page.close();
  }
}
