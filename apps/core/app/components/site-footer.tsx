import { IconBrandGithub } from "@tabler/icons-react";
import { Link } from "react-router";
import { projectInfo, siteConfig } from "~/config/site";

export function SiteFooter() {
  return (
    <footer className="bg-background/50 backdrop-blur-sm border-t border-border">
      <div className="max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-4">About</h3>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {projectInfo.description}
            </p>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-4">Quick links</h3>
            <ul className="space-y-2">
              {Object.entries(siteConfig.navigation).map(([name, path]) => (
                <li key={name}>
                  <Link
                    to={path}
                    className="text-muted-foreground hover:text-foreground transition-colors capitalize"
                  >
                    {name.replace("-", " ")}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-8 pt-8 border-t border-border">
          <p className="text-center text-muted-foreground text-sm">
            © {new Date().getFullYear()} {projectInfo.title}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
