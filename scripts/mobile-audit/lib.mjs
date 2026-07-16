import fs from 'node:fs';
import path from 'node:path';

export const VIEWPORTS = [
  { label: '375x667', width: 375, height: 667 },
  { label: '700x900', width: 700, height: 900 },
];

export async function loginToCore(page, coreUrl, { email, password }) {
  await page.goto(`${coreUrl}/auth/login`);
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL((url) => !url.pathname.startsWith('/auth/login'), { timeout: 15000 });
}

/**
 * True when the navigation landed where it was told to, rather than being
 * bounced to a login screen. AI Tutor and Question Maker never establish
 * their own session — they authenticate a request by forwarding the
 * incoming `Cookie` header to Core's `/api/sessions/validate`. A single
 * `loginToCore()` call is enough for all three apps ONLY because Better
 * Auth's dev cookie is host-only for `localhost` (no `Domain=` attribute set
 * — `crossSubDomainCookies` is disabled unless `COOKIE_DOMAIN` is
 * configured, and `useSecureCookies` is false over plain http://localhost)
 * — cookies are scoped by hostname, not port per RFC 6265, so the same
 * cookie is sent to :3000, :3001, and :5180 alike. If that ever stops being
 * true (e.g. a dev COOKIE_DOMAIN override, or auditing a non-localhost
 * deployment where each app is a real distinct origin), an unauthenticated
 * request bounces to Core's login page on a *different* origin than the one
 * requested — which this check catches instead of silently screenshotting
 * a login page as if it were the target.
 */
function isAuthenticatedNavigation(requestedUrl, finalUrl) {
  const requested = new URL(requestedUrl);
  const final = new URL(finalUrl);
  if (final.origin !== requested.origin) return false;
  return !/\/(auth\/)?login\b/i.test(final.pathname);
}

/** True when an anonymous session reached the requested public page (e.g. sign-in). */
function isPublicPageNavigation(requestedUrl, finalUrl) {
  const requested = new URL(requestedUrl);
  const final = new URL(finalUrl);
  if (final.origin !== requested.origin) return false;
  return final.pathname === requested.pathname;
}

export async function auditPage(page, { app, name, url, viewport, outDir, requiresAuth = true }) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(url, { waitUntil: 'networkidle' });

  const finalUrl = page.url();
  const authOk = requiresAuth
    ? isAuthenticatedNavigation(url, finalUrl)
    : isPublicPageNavigation(url, finalUrl);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );

  const sidebarAriaOk = await page.evaluate(() => {
    const trigger = document.querySelector('[data-slot="sidebar-trigger"]');
    if (!trigger) return null;
    return trigger.hasAttribute('aria-expanded') && trigger.hasAttribute('aria-controls');
  });

  fs.mkdirSync(outDir, { recursive: true });
  const screenshotPath = path.join(outDir, `${name}-${viewport.label}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  return {
    app,
    name,
    viewport: viewport.label,
    url,
    finalUrl,
    authOk,
    overflow,
    sidebarAriaOk,
    screenshotPath,
  };
}
