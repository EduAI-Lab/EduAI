/** Nav item keys — icons are mapped in `app-sidebar.tsx`. */
export type NavItemKey =
  | "dashboard"
  | "courses"
  | "chat"
  | "admin-users"
  | "admin-ai"
  | "admin-bugs"
  | "settings";

export type NavItem = {
  key: NavItemKey;
  title: string;
  url: string;
};

export type NavUser = {
  role?: string | null;
};
