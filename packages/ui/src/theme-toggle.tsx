import { useEffect, useState } from "react";
import { IconSun, IconMoon } from "@tabler/icons-react";
import { useTheme } from "./theme-provider";
import { cn } from "./utils";

export interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme();
  // next-themes only knows the real resolved theme after mount (it reads
  // localStorage/system preference client-side); rendering off it directly
  // on the first pass diverges from the server-rendered markup and trips a
  // React hydration-mismatch, which tears down and remounts this whole
  // subtree — including any in-flight sidebar navigation. Stay on a fixed
  // icon until mounted so the first client render matches the server.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && resolvedTheme === "dark";

  function toggleTheme() {
    setTheme(isDark ? "light" : "dark");
  }
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className={cn(
        "flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-muted-foreground transition-colors cursor-pointer hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {isDark ? (
        <IconSun size={18} aria-hidden="true" />
      ) : (
        <IconMoon size={18} aria-hidden="true" />
      )}
    </button>
  );
}
