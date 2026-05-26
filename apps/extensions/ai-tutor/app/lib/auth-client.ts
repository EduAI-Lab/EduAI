const CORE_URL = import.meta.env.VITE_CORE_URL || 'http://localhost:3000';

/**
 * Redirect the browser to Core's login page.
 * After the user authenticates, Core redirects back to this page and the
 * shared session cookie is set.
 */
export function signInWithEduAi() {
  const redirect = encodeURIComponent(window.location.href);
  window.location.assign(`${CORE_URL}/login?redirect=${redirect}`);
}

export { CORE_URL };
