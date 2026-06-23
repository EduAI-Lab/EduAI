import { Link, useNavigate } from "react-router";
import { Button } from "@eduai/ui";
import { cn } from "~/lib/utils";

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
    <nav className="bg-card/50 backdrop-blur-sm border-b border-border">
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
                    ? "border-green-500 text-foreground"
                    : "border-transparent text-muted-foreground hover:border-muted hover:text-foreground"
                )}
              >
                {item.name}
              </Link>
            ))}
          </div>
          <div className="flex items-center">
            <Button
              onClick={() => navigate("/dashboard")}
              className="bg-green-500 hover:bg-green-600 text-foreground px-4 py-2 rounded-md"
            >
              Dashboard
            </Button>
          </div>
        </div>
      </div>
    </nav>
  );
}
