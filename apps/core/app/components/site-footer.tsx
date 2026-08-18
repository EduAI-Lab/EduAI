import { Link } from "react-router";
import { projectInfo, siteConfig } from "~/config/site";

/**
 * Marketing footer.
 *
 * The link lists are explicit rather than derived from `siteConfig.navigation`:
 * that object also holds auth-gated destinations (/courses, /chat) which just
 * bounce a signed-out visitor to the login page, and its camelCase keys made
 * poor labels ("SignUp").
 */
const sectionLinks = [
  { name: "About", href: "#about" },
  { name: "Project goals", href: "#goals" },
  { name: "Our team", href: "#team" },
];

const productLinks = [
  { name: "Dashboard", to: siteConfig.navigation.dashboard },
  { name: "Log in", to: siteConfig.navigation.login },
  { name: "Sign up", to: siteConfig.navigation.signUp },
];

export function SiteFooter() {
  return (
    <footer className="bg-background border-t border-border">
      <div className="max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-4">About</h3>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {projectInfo.description}
            </p>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-4">On this page</h3>
            <ul className="space-y-2">
              {sectionLinks.map((link) => (
                <li key={link.name}>
                  <a
                    href={link.href}
                    className="text-muted-foreground text-sm hover:text-foreground transition-colors"
                  >
                    {link.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-4">Platform</h3>
            <ul className="space-y-2">
              {productLinks.map((link) => (
                <li key={link.name}>
                  <Link
                    to={link.to}
                    className="text-muted-foreground text-sm hover:text-foreground transition-colors"
                  >
                    {link.name}
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
