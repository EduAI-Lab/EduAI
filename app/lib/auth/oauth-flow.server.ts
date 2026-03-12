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

function stripOAuthPrompt(prompt: string) {
  const prompts = prompt
    .split(" ")
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => value !== "login" && value !== "create");

  return prompts.length > 0 ? prompts.join(" ") : undefined;
}

export function getOAuthContinuePath(requestUrl: string) {
  const searchParams = new URL(requestUrl).searchParams;
  if (!searchParams.has("sig")) {
    return undefined;
  }

  const authorizeParams = new URLSearchParams();

  for (const [key, value] of searchParams.entries()) {
    if (key === "sig") {
      break;
    }

    if (key === "exp") {
      continue;
    }

    if (key === "prompt") {
      const prompt = stripOAuthPrompt(value);
      if (prompt) {
        authorizeParams.append(key, prompt);
      }
      continue;
    }

    authorizeParams.append(key, value);
  }

  const query = authorizeParams.toString();
  return query.length > 0
    ? `/api/auth/oauth2/authorize?${query}`
    : "/api/auth/oauth2/authorize";
}

export function getOAuthQueryPayload(requestUrl: string) {
  return getSignedOAuthQuery(requestUrl);
}
