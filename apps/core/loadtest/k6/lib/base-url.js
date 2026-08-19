const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const FORBIDDEN_HOSTS = new Set(['dev.eduai.ok.ubc.ca', 'my.eduai.ok.ubc.ca']);

/**
 * Fail closed: default and allowed targets are loopback. A remote URL is
 * refused unless allowRemote === '1' (dedicated load-test host only).
 * The live study/prod hosts are never allowed, even with that opt-in.
 */
export function resolveLoadtestBaseUrl(raw, allowRemote) {
  const value = (raw && String(raw).trim()) || 'http://127.0.0.1:4100';
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`LOADTEST_BASE_URL is not a valid URL: ${value}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`LOADTEST_BASE_URL must be http(s): ${value}`);
  }
  const host = url.hostname.toLowerCase();
  if (FORBIDDEN_HOSTS.has(host)) {
    throw new Error(
      `LOADTEST_BASE_URL points at ${host}, which serves live EduAI traffic. ` +
        'This harness stays on an isolated instance. Do not override that.',
    );
  }
  if (!LOOPBACK_HOSTS.has(host) && allowRemote !== '1') {
    throw new Error(
      `LOADTEST_BASE_URL=${value} is not loopback. Default is http://127.0.0.1:4100. ` +
        'For a dedicated load-test host (never the study box), set LOADTEST_ALLOW_REMOTE=1.',
    );
  }
  return value.replace(/\/$/, '');
}
