import { Link, useNavigate } from "react-router";
import { Button, ThemeToggle } from "@eduai/ui";
import { cn } from "~/lib/utils";
import { siteConfig } from "~/config/site";

export interface SiteNavigationProps {
  currentPage: string;
}

const navigationItems = [
  { name: "Home", path: "/" },
  { name: "Team", path: "/team" },
];

export function SiteNavigation({ currentPage }: SiteNavigationProps) {
  const navigate = useNavigate();


  return (
    <nav className="bg-card border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex space-x-8">
            {navigationItems.map((item) => (
              <Link
                key={item.name}
                to={item.path}
                className={cn(
                  "inline-flex items-center px-1 pt-1 text-sm font-medium border-b-2",
                  currentPage === item.name.toLowerCase()
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:border-muted hover:text-foreground"
                )}
              >
                {item.name}
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Button variant="outline" onClick={() => navigate(siteConfig.navigation.login)}>
              Log in
            </Button>
            <Button variant="secondary" onClick={() => navigate(siteConfig.navigation.signUp)}>
              Sign up
            </Button>
            <Button onClick={() => navigate(siteConfig.navigation.dashboard)}>Dashboard</Button>
          </div>
        </div>
      </div>
    </nav>
  );
}
