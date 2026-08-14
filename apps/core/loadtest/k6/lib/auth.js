import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, DEMO_PASSWORD, studentForVU } from './config.js';

// k6 gives every VU its own implicit cookie jar, so logging in once per VU
// and reusing it across iterations faithfully mirrors a real browser session
// (login once, then many chat turns) instead of paying auth cost every turn.
const loggedInVUs = new Set();

/** Real better-auth email/password login — same endpoint the login page posts to. */
export function login() {
  if (loggedInVUs.has(__VU)) return true;

  const email = studentForVU(__VU);
  const res = http.post(
    `${BASE_URL}/api/auth/sign-in/email`,
    JSON.stringify({ email, password: DEMO_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login' } },
  );

  const ok = check(res, {
    'login succeeded': (r) => r.status === 200,
  });

  if (ok) loggedInVUs.add(__VU);
  else console.error(`[auth] login failed for ${email}: ${res.status} ${res.body}`);

  return ok;
}

export { studentForVU };
