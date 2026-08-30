import { Link, redirect } from "react-router";
import type { Route } from "./+types/home";
import { IconArrowRight, IconBulb } from "@tabler/icons-react";
import { Button, Card, CardContent, PageHeading } from "@eduai/ui";
import { SiteFooter } from "~/components/site-footer";
import { ApproachSection } from "~/components/approach-section";
import { HeroBackdrop } from "~/components/hero-backdrop";
import { HeroDemo } from "~/components/hero-demo";
import { ProductsSection } from "~/components/products-section";
import { ResearchSection } from "~/components/research-section";
import { TeamSection } from "~/components/team-section";
import { projectInfo, siteConfig } from "~/config/site";
import { SiteNavigation } from "~/components/site-navigation";
import { getRequestSession } from "~/lib/auth/request-session.server";

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "EduAI Learning" },
    {
      name: "description",
      content:
        "AI study tools from a research lab at UBC Okanagan. They answer from your own course materials and run on the university's own GPUs.",
    },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await getRequestSession(request);

  if (session?.user) {
    return redirect("/dashboard");
  }

  return {};
}

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteNavigation />

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border bg-muted/60 dark:bg-card">
        <HeroBackdrop />

        <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] max-w-7xl flex-col justify-center px-4 py-16 sm:px-6 lg:px-8">
          <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-16">
            <div className="max-w-3xl">
              <h1 className="text-4xl font-bold text-foreground lg:text-6xl">
                {projectInfo.title}
              </h1>
              <div
                aria-hidden="true"
                className="my-5 h-[3px] w-10 rounded-[2px] bg-[var(--gold)]"
              />
              <p className="text-xl leading-relaxed text-muted-foreground lg:text-2xl">
                {projectInfo.subtitle}
              </p>
              <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
                {projectInfo.description}
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <Link to={siteConfig.navigation.dashboard}>
                    Go to dashboard
                    <IconArrowRight className="ml-1 h-5 w-5" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link to={siteConfig.navigation.signUp}>Create an account</Link>
                </Button>
              </div>
            </div>

            <HeroDemo className="w-full lg:justify-self-end" />
          </div>
        </div>
      </section>

      {/* Striped content sections: odd = plain, even = muted; dividers between adjacent sections */}
      <div className="[&>section:nth-child(even)]:bg-muted/60 dark:[&>section:nth-child(even)]:bg-card [&>section+section]:border-t [&>section+section]:border-border">
        {/* What is EduAI */}
        <section id="about" className="scroll-mt-20 py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <PageHeading
              heading={`What is ${projectInfo.title}?`}
              className="mb-12 text-center [&>div]:mx-auto"
              headingClassName="text-3xl lg:text-4xl font-bold text-foreground"
            />

            <div className="grid items-start gap-10 lg:grid-cols-2">
              <div className="space-y-6">
                <p className="text-lg leading-relaxed text-muted-foreground">
                  EduAI is a research initiative at UBC Okanagan focused on developing and testing
                  AI-powered study tools in real-world educational settings.
                </p>

                <p className="text-lg leading-relaxed text-muted-foreground">
                  Our models run on UBC's own GPUs, so your questions and files stay on campus. We
                  are studying how to make AI tutors that are accurate, energy-efficient, and fair.
                </p>
              </div>

              <Card className="lg:self-stretch">
                <CardContent className="flex flex-col justify-center px-6 py-8">
                  <div className="flex flex-row items-center gap-3">
                    <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-[var(--radius-lg)] bg-primary/10">
                      <IconBulb className="h-6 w-6 text-primary-text" />
                    </div>
                    <h2 className="mb-3 text-lg font-semibold text-card-foreground">Our vision</h2>
                  </div>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {projectInfo.vision}
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <ApproachSection />

        <ProductsSection />

        <ResearchSection />

        <TeamSection />
      </div>

      {/* Closing CTA */}
      <section className="bg-primary py-20">
        <div className="mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-primary-foreground lg:text-4xl">
            Try it on your own course
          </h2>
          <div
            aria-hidden="true"
            className="mx-auto my-5 h-[3px] w-10 rounded-[2px] bg-[var(--gold)]"
          />
          <p className="mb-8 text-lg leading-relaxed text-primary-foreground/80">
            Create a free account and point the tutor at your own slides and syllabus, or open the
            dashboard if you are already set up.
          </p>

          <div className="flex flex-wrap justify-center gap-3">
            <Button asChild size="lg" variant="secondary">
              <Link to={siteConfig.navigation.dashboard}>
                Go to dashboard
                <IconArrowRight className="ml-1 h-5 w-5" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10"
            >
              <Link to={siteConfig.navigation.signUp}>Create an account</Link>
            </Button>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
