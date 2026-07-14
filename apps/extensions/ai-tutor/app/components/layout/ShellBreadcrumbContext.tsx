import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type ShellBreadcrumbItem = {
  label: string;
  href?: string;
  /** Custom content in place of the label (e.g. a course switcher). */
  node?: ReactNode;
  /** Full-text tooltip when `label` is a shortened form (e.g. "Module 1"). */
  title?: string;
};

type SetShellBreadcrumbItems = (items: ShellBreadcrumbItem[]) => void;

/**
 * Split into a setter-only context and a value-only context (pattern like
 * QM's `QmLayoutContext.tsx`, applied to breadcrumbs instead of profile/tour
 * state): a route calling `useShellBreadcrumbs` only ever consumes the
 * (referentially stable) setter, so publishing its own trail never re-renders
 * the route itself when a DIFFERENT route's trail changes. Only the
 * shell-level `HeaderBreadcrumbs` consumer subscribes to the value.
 */
const ShellBreadcrumbSetterContext = createContext<SetShellBreadcrumbItems | null>(null);
const ShellBreadcrumbItemsContext = createContext<ShellBreadcrumbItem[]>([]);

/**
 * Wraps the authenticated shell (`routes/_app.tsx`). AI Tutor routes fetch
 * course/module/lesson names client-side via `clientLoader`, so — unlike the
 * old per-route `<AppShell breadcrumbs={<ShellBreadcrumbs items={...} />}>`
 * prop-drilling — each route now publishes its own dynamic trail up to the
 * shared header via `useShellBreadcrumbs`.
 */
export function ShellBreadcrumbProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ShellBreadcrumbItem[]>([]);
  return (
    <ShellBreadcrumbSetterContext.Provider value={setItems}>
      <ShellBreadcrumbItemsContext.Provider value={items}>
        {children}
      </ShellBreadcrumbItemsContext.Provider>
    </ShellBreadcrumbSetterContext.Provider>
  );
}

/**
 * Route-level: publishes this page's breadcrumb trail (same item shape the
 * old `<ShellBreadcrumbs items={...} />` took) into the shell header. Call
 * unconditionally at the top of a route component; re-publishes whenever the
 * trail changes (e.g. once an async course/module/lesson title resolves).
 *
 * Fails soft (no-op) outside a `ShellBreadcrumbProvider` rather than
 * throwing — `routes/_app.tsx` always wraps `<Outlet />` in the provider
 * (including its brief pre-auth-resolved state), but this keeps route
 * components safe to render standalone in tests.
 */
export function useShellBreadcrumbs(items: ShellBreadcrumbItem[]) {
  const setItems = useContext(ShellBreadcrumbSetterContext);
  useEffect(() => {
    if (!setItems) return;
    setItems(items);
    return () => setItems([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, setItems]);
}

/** Shell-level: reads the active route's published breadcrumb trail. */
export function useShellBreadcrumbState(): ShellBreadcrumbItem[] {
  return useContext(ShellBreadcrumbItemsContext);
}
