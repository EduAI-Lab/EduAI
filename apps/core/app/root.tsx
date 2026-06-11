import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import type { Route } from "./+types/root";
import "./app.css";

import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";
import { AssistiveUiProvider } from "~/components/assistive/assistive-ui-provider";
import { UiPreferencesProvider } from "~/components/assistive/ui-preferences-provider";
import { DEFAULT_ACCOUNT_PREFERENCES } from "~/lib/user-preferences";
import { isUiDensity, isUiTheme, resolveThemeHtmlClass } from "~/lib/ui-preferences";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
];

const GUEST_ROOT_PREFERENCES = {
  assistive: false,
  motionReduced: false,
  density: DEFAULT_ACCOUNT_PREFERENCES.density,
  theme: DEFAULT_ACCOUNT_PREFERENCES.theme,
} as const;

/**
 * Resolves account-level UI preferences for every page render.
 * Guests always get defaults, guaranteeing baseline UI on public pages.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession(request);
  if (!session?.user) {
    return GUEST_ROOT_PREFERENCES;
  }

  const row = await prisma.userPreference.findUnique({
    where: { userId: session.user.id },
    select: {
      assistDefault: true,
      motionReduced: true,
      density: true,
      theme: true,
    },
  });

  return {
    assistive: row?.assistDefault ?? false,
    motionReduced: row?.motionReduced ?? false,
    density: isUiDensity(row?.density) ? row.density : DEFAULT_ACCOUNT_PREFERENCES.density,
    theme: isUiTheme(row?.theme) ? row.theme : DEFAULT_ACCOUNT_PREFERENCES.theme,
  };
}

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root");
  const themeClass = data ? resolveThemeHtmlClass(data.theme) : undefined;

  return (
    // Non-default hooks only — absent attributes/classes keep baseline pixel-identical.
    <html
      lang="en"
      className={themeClass}
      {...(data?.assistive ? { "data-assistive": "true" } : {})}
      {...(data?.motionReduced ? { "data-reduce-motion": "true" } : {})}
      {...(data?.density === "compact" ? { "data-density": "compact" } : {})}
    >
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App({ loaderData }: Route.ComponentProps) {
  return (
    <UiPreferencesProvider
      initialMotionReduced={loaderData?.motionReduced ?? false}
      initialDensity={loaderData?.density ?? DEFAULT_ACCOUNT_PREFERENCES.density}
      initialTheme={loaderData?.theme ?? DEFAULT_ACCOUNT_PREFERENCES.theme}
    >
      <AssistiveUiProvider initialAssistive={loaderData?.assistive ?? false}>
        <Outlet />
      </AssistiveUiProvider>
    </UiPreferencesProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
