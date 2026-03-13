import { Form, redirect, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { auth } from "~/lib/auth/server";

type PublicClient = {
  clientId?: string;
  name?: string | null;
  icon?: string | null;
  uri?: string | null;
  policy?: string | null;
  tos?: string | null;
};

async function getPublicClient(request: Request, clientId: string) {
  const url = new URL("/api/auth/oauth2/public-client", request.url);
  url.searchParams.set("client_id", clientId);

  const authRequest = new Request(url, {
    method: "GET",
    headers: {
      cookie: request.headers.get("cookie") ?? "",
    },
  });

  const response = await auth.handler(authRequest);
  if (!response.ok) {
    return null;
  }

  return (await response.json().catch(() => null)) as PublicClient | null;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession(request);
  const signedQuery = new URL(request.url).searchParams.toString();

  if (!session?.user) {
    return redirect(signedQuery ? `/auth/login?${signedQuery}` : "/auth/login");
  }

  const searchParams = new URL(request.url).searchParams;
  const clientId = searchParams.get("client_id");
  const scope = searchParams.get("scope") ?? "openid profile email";

  const client = clientId ? await getPublicClient(request, clientId) : null;

  return {
    client,
    clientId,
    scope,
    scopes: scope.split(/\s+/).filter(Boolean),
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const accept = formData.get("accept") === "true";
  const oauthQuery = new URL(request.url).searchParams.toString();
  const url = new URL("/api/auth/oauth2/consent", request.url);

  const authRequest = new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: request.headers.get("cookie") ?? "",
      origin: request.headers.get("origin") ?? new URL(request.url).origin,
      referer: request.headers.get("referer") ?? request.url,
    },
    body: JSON.stringify({
      accept,
      oauth_query: oauthQuery,
    }),
  });

  const response = await auth.handler(authRequest);
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      formError:
        payload?.message ??
        payload?.error_description ??
        payload?.error ??
        "Unable to process consent.",
    };
  }

  const redirectUri = payload?.redirect_uri ?? payload?.url;
  if (typeof redirectUri === "string" && redirectUri.length > 0) {
    return redirect(redirectUri);
  }

  return redirect("/dashboard");
}

export default function ConsentPage() {
  const { client, clientId, scopes } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const appName = client?.name || clientId || "This application";

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-xl">
        <CardHeader className="space-y-3">
          <CardTitle>Authorize Application</CardTitle>
          <CardDescription>
            {appName} is requesting access to your EduAI account.
          </CardDescription>
          {client?.uri ? (
            <a
              className="text-sm text-primary underline-offset-4 hover:underline"
              href={client.uri}
              rel="noreferrer"
              target="_blank"
            >
              {client.uri}
            </a>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium">Requested scopes</p>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {scopes.map((scope) => (
                <li key={scope} className="rounded-md border px-3 py-2 font-mono">
                  {scope}
                </li>
              ))}
            </ul>
          </div>
          {actionData?.formError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {actionData.formError}
            </div>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-wrap justify-end gap-3">
          {client?.policy ? (
            <a
              className="mr-auto text-sm text-muted-foreground underline-offset-4 hover:underline"
              href={client.policy}
              rel="noreferrer"
              target="_blank"
            >
              Privacy policy
            </a>
          ) : null}
          {client?.tos ? (
            <a
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
              href={client.tos}
              rel="noreferrer"
              target="_blank"
            >
              Terms of service
            </a>
          ) : null}
          <Form method="post">
            <input name="accept" type="hidden" value="false" />
            <Button type="submit" variant="outline">
              Decline
            </Button>
          </Form>
          <Form method="post">
            <input name="accept" type="hidden" value="true" />
            <Button type="submit">Authorize</Button>
          </Form>
        </CardFooter>
      </Card>
    </div>
  );
}
