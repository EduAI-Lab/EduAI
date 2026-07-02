import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import type { Route } from "./+types/root";
import "./app.css";

import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";
import { getPolicy } from "~/lib/policy.server";
import { getExpiredPasswordRedirect } from "~/lib/auth/password-expiry.server";
import { ensureCronSchedulerRunning } from "~/lib/cron-scheduler.server";
import { AssistiveUiProvider } from "~/components/assistive/assistive-ui-provider";
import { ThemeProvider } from "~/components/theme-provider";
import { Toaster, PageLoader } from "@eduai/ui";
import { UiPreferencesProvider } from "~/components/assistive/ui-preferences-provider";
import { DEFAULT_ACCOUNT_PREFERENCES } from "~/lib/user-preferences";
import { isUiDensity, isUiTheme } from "~/lib/ui-preferences";
import { ThemeSyncInitializer } from "~/components/theme-sync-initializer";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Outfit:wght@100..900&display=swap",
  },
];

const GUEST_ROOT_PREFERENCES = {
  assistive: false,
  motionReduced: false,
  density: DEFAULT_ACCOUNT_PREFERENCES.density,
  theme: DEFAULT_ACCOUNT_PREFERENCES.theme,
  // Whether the signed-in user may issue invitations (UNIT_ADMIN gated by the
  // `unitAdmins.canInvite` policy). Resolved server-side and read by the sidebar
  // so the Invitations link doesn't depend on a client-side policy fetch.
  canInvite: false,
} as const;

/**
 * Resolves account-level UI preferences for every page render.
 * Guests always get defaults, guaranteeing baseline UI on public pages.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  ensureCronSchedulerRunning();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return GUEST_ROOT_PREFERENCES;
  }

  // #339: enforce annual password rotation. Skip the check on /settings and
  // /auth/* so the user can actually reach the change-password form and log out.
  const url = new URL(request.url);
  const isExempt =
    url.pathname.startsWith("/settings") ||
    url.pathname.startsWith("/auth/");
  if (!isExempt) {
    const expiredRedirect = await getExpiredPasswordRedirect(session.user.id);
    if (expiredRedirect) return expiredRedirect;
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

  // ADMIN always sees its admin nav (incl. Invitations); only a UNIT_ADMIN's
  // link is policy-gated, so only that role needs the extra lookup.
  const canInvite =
    session.user.role === "UNIT_ADMIN"
      ? await getPolicy("unitAdmins.canInvite")
      : false;

  return {
    assistive: row?.assistDefault ?? false,
    motionReduced: row?.motionReduced ?? false,
    density: isUiDensity(row?.density) ? row.density : DEFAULT_ACCOUNT_PREFERENCES.density,
    theme: isUiTheme(row?.theme) ? row.theme : DEFAULT_ACCOUNT_PREFERENCES.theme,
    canInvite,
  };
}

export function HydrateFallback() {
  return <PageLoader />;
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        {/* Inline script: match next-themes class + color-scheme before hydration */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||((t==='system'||!t)&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.add(d?'dark':'light');r.style.colorScheme=d?'dark':'light'}catch(e){}})()`,
          }}
        />
      </head>
      <body>
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
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
    >
      <AssistiveUiProvider initialAssistive={loaderData?.assistive ?? false}>
        <ThemeSyncInitializer />
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
