/**
 * Shared session login for research/dev scripts against EduAI.
 */
export async function loginEduAI({
  baseUrl = (process.env.RESEARCH_BASE_URL || process.env.CHAT_SMOKE_URL || "https://dev.eduai.ok.ubc.ca").replace(
    /\/$/,
    "",
  ),
  email = process.env.RESEARCH_EMAIL || process.env.CHAT_SMOKE_EMAIL || "admin@eduai.local",
  password = process.env.RESEARCH_PASSWORD || process.env.CHAT_SMOKE_PASSWORD,
} = {}) {
  if (!password) {
    throw new Error("Set RESEARCH_PASSWORD or CHAT_SMOKE_PASSWORD");
  }

  const body = new URLSearchParams({ email, password });
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    redirect: "manual",
  });

  const setCookie = res.headers.getSetCookie?.() ?? [];
  const raw = setCookie.length ? setCookie : [res.headers.get("set-cookie")].filter(Boolean);
  const token = raw
    .flatMap((c) => String(c).split(/,(?=[^;]+?=)/))
    .map((c) => c.trim())
    .find((c) => c.startsWith("__Secure-better-auth.session_token="));

  if (!token) {
    throw new Error(`Login failed — HTTP ${res.status}, no session cookie`);
  }

  return {
    baseUrl,
    cookie: token.split(";")[0],
  };
}

export async function fetchJson(url, { cookie, method = "GET", body, headers = {} } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      Cookie: cookie,
      ...headers,
    },
    body,
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-json */
  }

  return { res, text, json };
}
