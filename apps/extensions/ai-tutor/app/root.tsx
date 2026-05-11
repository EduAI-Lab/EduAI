import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from 'react-router';

import type { Route } from './+types/root';
import './app.css';
import { AuthProvider } from '~/hooks/useLocalUser';
import { TourProvider } from '~/components/TourProvider';
import { BugReportProvider } from '~/components/bug-report/BugReportProvider';

// Theme script runs before React hydration to prevent flash.
// The app currently forces dark mode globally.
const themeScript = `(function(){
  document.documentElement.classList.add("dark");
})();`;

export const links: Route.LinksFunction = () => [
  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  {
    rel: 'preconnect',
    href: 'https://fonts.gstatic.com',
    crossOrigin: 'anonymous',
  },
  // Satoshi - Modern geometric sans for body text
  {
    rel: 'stylesheet',
    href: 'https://api.fontshare.com/v2/css?f[]=satoshi@400,500,600,700&display=swap',
  },
  // Fraunces - Distinctive old-style serif for display headings
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..900;1,9..144,300..900&display=swap',
  },
  // JetBrains Mono - For code and monospace elements
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap',
  },
];

export function HydrateFallback() {
  return (
    <div className="min-h-dvh bg-gradient-to-br from-gray-50 to-white dark:from-gray-950 dark:to-gray-900 flex items-center justify-center">
      <div className="text-sm text-gray-600 dark:text-gray-300">Loading…</div>
    </div>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* Theme script MUST run before CSS loads to prevent flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: themeScript,
          }}
        />
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

export default function App() {
  return (
    <AuthProvider initialUser={null}>
      <BugReportProvider>
        <TourProvider>
          <Outlet />
        </TourProvider>
      </BugReportProvider>
    </AuthProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = 'Oops!';
  let details = 'An unexpected error occurred.';
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? '404' : 'Error';
    details =
      error.status === 404 ? 'The requested page could not be found.' : error.statusText || details;
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
