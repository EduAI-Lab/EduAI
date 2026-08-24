const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const FORBIDDEN_HOSTS = new Set(["dev.eduai.ok.ubc.ca", "my.eduai.ok.ubc.ca"]);

/**
 * `URL.hostname` keeps a trailing FQDN dot (`dev.eduai.ok.ubc.ca.`), so an
 * exact-host block would miss it. Lowercase and strip trailing dots first.
 */
function canonicalizeHostname(hostname) {
  return hostname.toLowerCase().replace(/\.+$/, "");
}

/**
 * k6 (Sobek) has no WHATWG `URL` global. Parse just enough of an http(s)
 * absolute URL to apply the loopback / live-host policy in both Node tests
 * and `k6 run`. Host is the authority *after* the last `@` so
 * `https://127.0.0.1@dev.eduai.ok.ubc.ca` cannot bypass the study-host block
 * the way a naive `[^/?#:]+` hostname would.
 */
export function parseLoadtestHttpUrl(value) {
  const trimmed = String(value).trim();
  const scheme = trimmed.match(/^(https?):\/\//i);
  if (!scheme) {
    throw new Error(`LOADTEST_BASE_URL is not a valid URL: ${value}`);
  }
  const rest = trimmed.slice(scheme[0].length);
  const authorityEnd = rest.search(/[/?#]/);
  const authority = authorityEnd === -1 ? rest : rest.slice(0, authorityEnd);
  if (!authority) {
    throw new Error(`LOADTEST_BASE_URL is not a valid URL: ${value}`);
  }
  const hostport = authority.slice(authority.lastIndexOf("@") + 1);
  let hostname = "";
  const ipv6 = hostport.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (ipv6) {
    hostname = ipv6[1];
  } else {
    const colon = hostport.lastIndexOf(":");
    if (colon !== -1) {
      const port = hostport.slice(colon + 1);
      if (!/^\d+$/.test(port)) {
        throw new Error(`LOADTEST_BASE_URL is not a valid URL: ${value}`);
      }
      hostname = hostport.slice(0, colon);
    } else {
      hostname = hostport;
    }
  }
  if (!hostname) {
    throw new Error(`LOADTEST_BASE_URL is not a valid URL: ${value}`);
  }
  return {
    protocol: `${scheme[1].toLowerCase()}:`,
    hostname,
  };
}

/**
 * Fail closed: default and allowed targets are loopback. A remote URL is
 * refused unless allowRemote === '1' (dedicated load-test host only).
 * The live study/prod hosts are never allowed, even with that opt-in.
 */
export function resolveLoadtestBaseUrl(raw, allowRemote) {
  const value = (raw && String(raw).trim()) || "http://127.0.0.1:4100";
  const url = parseLoadtestHttpUrl(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`LOADTEST_BASE_URL must be http(s): ${value}`);
  }
  const host = canonicalizeHostname(url.hostname);
  if (FORBIDDEN_HOSTS.has(host)) {
    throw new Error(
      `LOADTEST_BASE_URL points at ${host}, which serves live EduAI traffic. ` +
        "This harness stays on an isolated instance. Do not override that.",
    );
  }
  if (!LOOPBACK_HOSTS.has(host) && allowRemote !== "1") {
    throw new Error(
      `LOADTEST_BASE_URL=${value} is not loopback. Default is http://127.0.0.1:4100. ` +
        "For a dedicated load-test host (never the study box), set LOADTEST_ALLOW_REMOTE=1.",
    );
  }
  return value.replace(/\/$/, "");
}
