import { Link } from "react-router";
import { Button, ThemeToggle } from "@eduai/ui";
import { siteConfig } from "~/config/site";
import { scrollToSection } from "~/lib/scroll-to-section";

/**
 * Marketing header for the single-scroll landing page.
 *
 * The nav items are in-page anchors, not routes — the landing page is one
 * document now, so there is nowhere to navigate to. The Dashboard entry point
 * moved into the page body (hero + closing CTA band); the header keeps only the
 * auth actions and the theme toggle.
 */
const navigationItems = [
  { name: "About", href: "#about" },
  { name: "Products", href: "#products" },
  { name: "Goals", href: "#goals" },
  { name: "Team", href: "#team" },
];

export function SiteNavigation() {
  return (
    <nav className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-4">
          <div className="flex items-center gap-8">
            <Link to={siteConfig.navigation.home} className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="h-6 w-1 rounded-[2px] bg-[var(--gold)]"
              />
              <span className="text-base font-semibold text-foreground">{siteConfig.name}</span>
            </Link>

            <div className="hidden items-center gap-6 md:flex">
              {navigationItems.map((item) => (
                <a
                  key={item.name}
                  href={item.href}
                  onClick={(event) => scrollToSection(event, item.href)}
                  className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  {item.name}
                </a>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <ThemeToggle />
            <Button asChild variant="outline">
              <Link to={siteConfig.navigation.login}>Log in</Link>
            </Button>
            <Button asChild variant="secondary" className="hidden sm:inline-flex">
              <Link to={siteConfig.navigation.signUp}>Sign up</Link>
            </Button>
          </div>
        </div>
      </div>
    </nav>
  );
}
