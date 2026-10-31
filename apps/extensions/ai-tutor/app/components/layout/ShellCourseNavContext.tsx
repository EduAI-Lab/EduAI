import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { CourseNavConfig } from "@eduai/ui";

type SetShellCourseNav = (config: CourseNavConfig | undefined) => void;

/**
 * The course menu a route asks the shell to show, published the same way as
 * the breadcrumb trail (see `ShellBreadcrumbContext`): a stable setter for
 * routes, and a value context only the shell reads.
 */
const ShellCourseNavSetterContext = createContext<SetShellCourseNav | null>(null);
const ShellCourseNavValueContext = createContext<CourseNavConfig | undefined>(undefined);

export function ShellCourseNavProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<CourseNavConfig | undefined>(undefined);
  return (
    <ShellCourseNavSetterContext.Provider value={setConfig}>
      <ShellCourseNavValueContext.Provider value={config}>
        {children}
      </ShellCourseNavValueContext.Provider>
    </ShellCourseNavSetterContext.Provider>
  );
}

/**
 * Route-level: shows `config` as the shell's course menu while this route is
 * mounted. Pass a memoized config — it is re-published whenever its identity
 * changes. A no-op outside the provider, so routes render standalone in tests.
 */
export function useShellCourseNav(config: CourseNavConfig | undefined) {
  const setConfig = useContext(ShellCourseNavSetterContext);
  useEffect(() => {
    if (!setConfig) return;
    setConfig(config);
    return () => setConfig(undefined);
  }, [config, setConfig]);
}

/** Shell-level: the active route's course menu, if it published one. */
export function useShellCourseNavState(): CourseNavConfig | undefined {
  return useContext(ShellCourseNavValueContext);
}
