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
import { AssistiveModeProvider } from '~/components/settings/assistive-mode';
// Import from narrow subpaths, NOT the `@eduai/ui` barrel. The barrel
// (`packages/ui/src/index.ts`) re-exports ~93 modules via `export *`; pulling
// even one named member from it forces Vite dev to crawl and transform the
// whole shared UI library (shiki, markdown, every Radix primitive,
// @tabler icons) on first load — for every user, before login. root renders
// for everyone, so keep its UI imports minimal.
import { ThemeProvider } from '@eduai/ui/theme-provider';
import { ThemeSyncInitializer } from '@eduai/ui/theme-sync-initializer';
import { Toaster } from '@eduai/ui/sonner';
import { PageLoader } from '@eduai/ui/page-loader';

// No `links()` export: Outfit is self-hosted via @fontsource-variable/outfit,
// imported from @eduai/ui's base.css and bundled with the app stylesheet (#1221).

export function HydrateFallback() {
  return <PageLoader />;
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(t==='system'||!t)&&window.matchMedia('(prefers-color-scheme: dark)').matches){document.documentElement.classList.add('dark')}}catch(e){}})()`,
          }}
        />
        <Meta />
        <Links />
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

export default function App() {
  return (
    <AuthProvider initialUser={null}>
      <BugReportProvider>
        <TourProvider>
          <AssistiveModeProvider>
            <ThemeSyncInitializer />
            <Outlet />
          </AssistiveModeProvider>
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
