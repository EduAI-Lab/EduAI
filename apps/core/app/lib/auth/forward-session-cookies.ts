/** Forward every Set-Cookie from a Better Auth handler response (session + CSRF, etc.). */
export function appendAuthSetCookies(response: Response, headers: Headers): void {
  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [];

  if (setCookies.length > 0) {
    for (const cookie of setCookies) {
      headers.append("Set-Cookie", cookie);
    }
    return;
  }

  const single = response.headers.get("Set-Cookie");
  if (single) {
    headers.append("Set-Cookie", single);
  }
}
