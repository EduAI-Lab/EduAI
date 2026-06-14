/** Log failed /api/chat responses to the browser console for debugging. */
export async function logChatApiResponse(response: Response, label = "chat"): Promise<void> {
  if (response.ok) {
    return;
  }

  let body: unknown = null;
  try {
    body = await response.clone().json();
  } catch {
    try {
      body = await response.clone().text();
    } catch {
      body = "(unable to read response body)";
    }
  }

  console.error(`[${label}] /api/chat rejected`, {
    status: response.status,
    statusText: response.statusText,
    body,
  });
}

export function logChatUseChatError(error: Error, label = "chat"): void {
  const cause =
    "cause" in error && error.cause !== undefined ? error.cause : undefined;
  console.error(`[${label}] useChat error`, {
    message: error.message,
    name: error.name,
    cause,
    stack: error.stack,
  });
}
