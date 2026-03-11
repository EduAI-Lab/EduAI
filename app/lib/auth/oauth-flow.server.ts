function getSignedOAuthQuery(requestUrl: string) {
  const params = new URL(requestUrl).searchParams;
  if (!params.has("sig")) {
    return undefined;
  }

  const signedParams = new URLSearchParams();
  for (const [key, value] of params.entries()) {
    signedParams.append(key, value);
    if (key === "sig") {
      break;
    }
  }

  const query = signedParams.toString();
  return query.length > 0 ? query : undefined;
}

export function getOAuthContinuePath(requestUrl: string) {
  const oauthQuery = getSignedOAuthQuery(requestUrl);
  if (!oauthQuery) {
    return undefined;
  }

  return `/api/auth/oauth2/authorize?${oauthQuery}`;
}

export function getOAuthQueryPayload(requestUrl: string) {
  return getSignedOAuthQuery(requestUrl);
}
