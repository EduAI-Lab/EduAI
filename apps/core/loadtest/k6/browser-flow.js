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
import { browser } from "k6/browser";
import { check } from "k6";
import { BASE_URL, DEMO_PASSWORD, COURSE_CODE, studentForVU } from "./lib/config.js";

export const options = {
  scenarios: {
    browser_chat: {
      executor: "ramping-vus",
      exec: "browserChatFlow",
      startVUs: 0,
      stages: __ENV.BROWSER_SMOKE
        ? [
            { duration: "10s", target: Number(__ENV.BROWSER_VUS || 2) },
            { duration: "40s", target: Number(__ENV.BROWSER_VUS || 2) },
            { duration: "10s", target: 0 },
          ]
        : [
            { duration: "20s", target: 5 },
            { duration: "40s", target: Number(__ENV.BROWSER_VUS || 20) },
            { duration: "1m", target: Number(__ENV.BROWSER_VUS || 20) },
            { duration: "20s", target: 0 },
          ],
      options: {
        browser: { type: "chromium" },
      },
    },
  },
  thresholds: {
    checks: ["rate>0.9"],
  },
};

export async function browserChatFlow() {
  const page = await browser.newPage();
  const email = studentForVU(__VU);

  try {
    await page.goto(`${BASE_URL}/auth/login`, { waitUntil: "networkidle" });

    // `#email` / `#password` — the login form ids. `input[name="email"]` matches
    // the real field AND the demo-login hidden inputs, which k6 rejects as a
    // strict-mode violation (this is what the first 5-VU run actually hit).
    await page.locator("input#email").fill(email);
    await page.locator("input#password").fill(DEMO_PASSWORD);
    await Promise.all([page.waitForNavigation(), page.locator('button[type="submit"]').click()]);

    check(page, {
      "left the login page after submit": (p) => !p.url().includes("/auth/login"),
    });

    // Seeded loadtest VUs have no student number, so first login lands on
    // /onboarding/student-id. Skip it the same way a TA without a number would.
    if (page.url().includes("/onboarding/student-id")) {
      await page.evaluate(() => {
        const btn = document.querySelector('button[name="intent"][value="skip"]');
        if (btn) btn.click();
      });
      await page.waitForNavigation().catch(() => {});
    }

    let appeared = false;
    try {
      await page.goto(`${BASE_URL}/chat?courseCode=${encodeURIComponent(COURSE_CODE)}`, {
        waitUntil: "networkidle",
      });

      // page.$ is CSS-only; :has-text() is invalid there. Click by text in the
      // page so a missing modal is a no-op instead of a thrown selector error.
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll("button")].find(
          (b) => (b.textContent || "").trim() === "I understand",
        );
        if (btn) btn.click();
      });
      await page.waitForTimeout(500);

      const input = page.locator("#chat-message-input");
      await input.waitFor({ state: "visible", timeout: 15000 });
      await input.click();
      await input.type("Can you summarize the last lecture in one paragraph?");
      await page.evaluate(() => {
        const btn = document.querySelector('button[aria-label="Send message"]');
        if (btn && !btn.disabled) btn.click();
      });

      // k6's locator engine is not Playwright — `text=…` never matches here.
      // Poll the rendered page text for the mock's canned phrase.
      for (let i = 0; i < 40; i++) {
        appeared = await page.evaluate(() =>
          (document.body && document.body.innerText ? document.body.innerText : "").includes(
            "concise answer based on the course material",
          ),
        );
        if (appeared) break;
        await page.waitForTimeout(500);
      }
      if (!appeared) {
        const snippet = await page.evaluate(() =>
          (document.body && document.body.innerText ? document.body.innerText : "").slice(0, 400),
        );
        console.error(`[browser] VU ${__VU} no assistant text. page snippet: ${snippet}`);
      }
    } catch (err) {
      console.error(`[browser] VU ${__VU} chat flow failed: ${err}`);
    }
    check(null, { "assistant response rendered": () => appeared });
  } finally {
    await page.close();
  }
}
