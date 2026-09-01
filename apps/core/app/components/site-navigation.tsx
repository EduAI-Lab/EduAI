import { useState } from "react";
import { Link } from "react-router";
import { Button, ThemeToggle } from "@eduai/ui";
import { IconMenu2, IconX } from "@tabler/icons-react";
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
  { name: "Approach", href: "#approach" },
  { name: "Products", href: "#products" },
  { name: "Research", href: "#research" },
  { name: "Team", href: "#team" },
];

export function SiteNavigation() {
  // The links do not fit the bar under `md`, so below that they move into a
  // disclosure panel rather than disappearing: the footer carries the same
  // anchors, but a mobile reader should not have to scroll the whole page to
  // reach the jump list at the top of it.
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-4">
          <div className="flex items-center gap-8">
            <Link to={siteConfig.navigation.home} className="flex items-center gap-2.5">
              <img
                src="/eduai-graduation.svg"
                alt=""
                aria-hidden="true"
                width={28}
                height={28}
                className="h-7 w-7 rounded-md"
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
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-expanded={menuOpen}
              aria-controls="site-nav-sections"
              aria-label={menuOpen ? "Close section menu" : "Open section menu"}
              onClick={() => setMenuOpen((open) => !open)}
              className="md:hidden"
            >
              {menuOpen ? (
                <IconX aria-hidden="true" className="h-5 w-5" />
              ) : (
                <IconMenu2 aria-hidden="true" className="h-5 w-5" />
              )}
            </Button>
          </div>
        </div>

        {/* Kept mounted but hidden so the anchors stay in the DOM order a
            reader tabs through, and so the toggle's aria-controls always
            resolves to a real element. */}
        <div
          id="site-nav-sections"
          hidden={!menuOpen}
          className="border-t border-border py-2 md:hidden"
        >
          <ul className="flex flex-col">
            {navigationItems.map((item) => (
              <li key={item.name}>
                <a
                  href={item.href}
                  onClick={(event) => {
                    scrollToSection(event, item.href);
                    setMenuOpen(false);
                  }}
                  className="block rounded-[var(--radius-md)] px-2 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {item.name}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </nav>
  );
}
