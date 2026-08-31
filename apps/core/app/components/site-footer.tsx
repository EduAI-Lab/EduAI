import { Link } from "react-router";
import { projectInfo, siteConfig } from "~/config/site";
import { scrollToSection } from "~/lib/scroll-to-section";

/**
 * Marketing footer.
 *
 * The link lists are explicit rather than derived from `siteConfig.navigation`,
 * whose camelCase keys made poor labels ("SignUp"). Only the auth entry points
 * are listed: the landing page's loader redirects anyone with a session to
 * /dashboard, so every reader of this footer is signed out and a /dashboard
 * link would only bounce them through /login.
 */
const sectionLinks = [
  { name: "About", href: "#about" },
  { name: "Products", href: "#products" },
  { name: "Research", href: "#research" },
  { name: "Our team", href: "#team" },
];

const productLinks = [
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
                    onClick={(event) => scrollToSection(event, link.href)}
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
          <p className="text-center text-muted-foreground text-sm">{projectInfo.attribution}</p>
          <p className="text-center text-muted-foreground text-sm mt-2">
            © {new Date().getFullYear()} {projectInfo.title}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
