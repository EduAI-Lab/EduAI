import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, DEMO_PASSWORD, studentForVU } from './config.js';

// k6 gives every VU its own implicit cookie jar, so logging in once per VU
// and reusing it across iterations faithfully mirrors a real browser session
// (login once, then many chat turns) instead of paying auth cost every turn.
const loggedInVUs = new Set();

/**
 * Posts to better-auth's email/password JSON API (`/api/auth/sign-in/email`).
 * This is NOT the login page's Remix `<Form method="post">` action, which also
 * writes audit logs and handles `forceReauth`. We use the API because k6 VUs
 * need a cookie jar, not an HTML round-trip; login cost is therefore slightly
 * under-measured vs a real browser.
 */
export function login() {
  if (loggedInVUs.has(__VU)) return true;

  const email = studentForVU(__VU);
  const res = http.post(
    `${BASE_URL}/api/auth/sign-in/email`,
    JSON.stringify({ email, password: DEMO_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login' } },
  );

  const jar = http.cookieJar();
  const cookies = jar.cookiesForURL(BASE_URL);
  const ok = check(res, {
    'login succeeded': (r) => r.status === 200,
    'session cookie held after login': () =>
      Object.keys(cookies).some((c) => c.includes('session_token')),
  });

  if (ok) loggedInVUs.add(__VU);
  else console.error(`[auth] login failed for ${email}: ${res.status} ${res.body}`);

  return ok;
}

export { studentForVU };
