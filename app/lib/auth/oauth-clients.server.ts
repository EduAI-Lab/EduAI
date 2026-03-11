import { z } from "zod";

import { auth } from "./server";

const SISTER_APP_TYPE = "sister-app";

const clientMetadataSchema = z.record(z.string(), z.unknown()).optional();

export const createOAuthClientSchema = z.object({
  redirect_uris: z.array(z.string().url()).min(1),
  client_name: z.string().min(1).optional(),
  client_uri: z.string().url().optional(),
  logo_uri: z.string().url().optional(),
  contacts: z.array(z.string()).optional(),
  tos_uri: z.string().url().optional(),
  policy_uri: z.string().url().optional(),
  post_logout_redirect_uris: z.array(z.string().url()).optional(),
  metadata: clientMetadataSchema,
});

export const updateOAuthClientSchema = z.object({
  client_name: z.string().min(1).optional(),
  client_uri: z.string().url().optional(),
  logo_uri: z.string().url().optional(),
  contacts: z.array(z.string()).optional(),
  tos_uri: z.string().url().optional(),
  policy_uri: z.string().url().optional(),
  redirect_uris: z.array(z.string().url()).optional(),
  post_logout_redirect_uris: z.array(z.string().url()).optional(),
  metadata: clientMetadataSchema,
}).refine((value) => Object.keys(value).length > 0, {
  message: "At least one field must be provided",
});

type OAuthClientRecord = {
  clientId?: string;
  client_id?: string;
  metadata?: unknown;
};

function getClientId(client: OAuthClientRecord) {
  if (typeof client.clientId === "string" && client.clientId.length > 0) {
    return client.clientId;
  }

  if (typeof client.client_id === "string" && client.client_id.length > 0) {
    return client.client_id;
  }

  return undefined;
}

function getClientMetadata(client: unknown) {
  if (!client || typeof client !== "object") {
    return undefined;
  }

  const metadata =
    "metadata" in client
      ? (client as Record<string, unknown>).metadata
      : client;

  return metadata && typeof metadata === "object"
    ? (metadata as Record<string, unknown>)
    : undefined;
}

function normalizeOAuthClients(payload: unknown) {
  if (Array.isArray(payload)) {
    return payload as OAuthClientRecord[];
  }

  if (payload && typeof payload === "object") {
    const objectPayload = payload as Record<string, unknown>;
    if (Array.isArray(objectPayload.clients)) {
      return objectPayload.clients as OAuthClientRecord[];
    }

    if (Array.isArray(objectPayload.data)) {
      return objectPayload.data as OAuthClientRecord[];
    }
  }

  return [];
}

export function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
}

export async function requireAdminSession(request: Request) {
  const session = await auth.api.getSession(request);
  if (!session?.user) {
    throw json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "ADMIN") {
    throw json({ error: "Forbidden" }, { status: 403 });
  }

  return session;
}

export function isSisterAppClient(clientOrMetadata: unknown) {
  const metadata = getClientMetadata(clientOrMetadata);

  return Boolean(
    metadata &&
      metadata.appType === SISTER_APP_TYPE,
  );
}

async function getOAuthClients(request: Request) {
  const clients = await auth.api.getOAuthClients({
    headers: request.headers,
  });

  return normalizeOAuthClients(clients);
}

export async function listSisterAppClients(request: Request) {
  const clients = await getOAuthClients(request);
  return clients.filter((client) => isSisterAppClient(client));
}

export async function requireSisterAppClient(request: Request, clientId: string) {
  const client = (await listSisterAppClients(request)).find(
    (candidate) => getClientId(candidate) === clientId,
  );

  if (!client) {
    throw json({ error: "OAuth client not found" }, { status: 404 });
  }

  return client;
}

export async function createSisterAppClient(
  request: Request,
  input: z.infer<typeof createOAuthClientSchema>,
) {
  return auth.api.adminCreateOAuthClient({
    headers: request.headers,
    body: {
      ...input,
      skip_consent: true,
      enable_end_session: false,
      scope: "openid profile email",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
      client_secret_expires_at: 0,
      require_pkce: true,
      type: "web",
      metadata: {
        ...(input.metadata || {}),
        appType: SISTER_APP_TYPE,
      },
    },
  });
}

export async function updateSisterAppClient(
  request: Request,
  clientId: string,
  input: z.infer<typeof updateOAuthClientSchema>,
) {
  const existingClient = await requireSisterAppClient(request, clientId);
  const existingMetadata = getClientMetadata(existingClient);

  return auth.api.adminUpdateOAuthClient({
    headers: request.headers,
    body: {
      client_id: clientId,
      update: {
        ...input,
        skip_consent: true,
        enable_end_session: false,
        metadata: input.metadata
          ? {
              ...(existingMetadata || {}),
              ...input.metadata,
              appType: SISTER_APP_TYPE,
            }
          : {
              ...(existingMetadata || {}),
              appType: SISTER_APP_TYPE,
            },
      },
    },
  });
}

export async function rotateSisterAppClientSecret(request: Request, clientId: string) {
  await requireSisterAppClient(request, clientId);

  return auth.api.rotateClientSecret({
    headers: request.headers,
    body: {
      client_id: clientId,
    },
  });
}

export async function deleteSisterAppClient(request: Request, clientId: string) {
  await requireSisterAppClient(request, clientId);

  return auth.api.deleteOAuthClient({
    headers: request.headers,
    body: {
      client_id: clientId,
    },
  });
}
