import { Link, useNavigate } from "react-router";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

interface SiteNavigationProps {
  currentPage: string;
}

const navigationItems = [
  { name: "Home", path: "/" },
  { name: "Team", path: "/team" },
];

export function SiteNavigation({ currentPage }: SiteNavigationProps) {
  const navigate = useNavigate();


  return (
    <nav className="bg-slate-800/50 backdrop-blur-sm border-b border-slate-700">
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
                    ? "border-green-500 text-white"
                    : "border-transparent text-slate-300 hover:border-slate-300 hover:text-white"
                )}
              >
                {item.name}
              </Link>
            ))}
          </div>
          <div className="flex items-center">
            <Button
              onClick={() => navigate("/dashboard")}
              className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-md"
            >
              Dashboard
            </Button>
          </div>
        </div>
      </div>
    </nav>
  );
}
