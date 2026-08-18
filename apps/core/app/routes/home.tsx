import { Link, redirect } from "react-router";
import type { Route } from "./+types/home";
import {
  IconArrowRight,
  IconBook,
  IconBulb,
  IconCpu,
  IconUsers,
} from "@tabler/icons-react";
import { Button, Card, CardContent, PageHeading } from "@eduai/ui";
import { SiteFooter } from "~/components/site-footer";
import { ProjectGoals } from "~/components/project-goals";
import { TeamSection } from "~/components/team-section";
import { projectInfo, siteConfig } from "~/config/site";
import { SiteNavigation } from "~/components/site-navigation";
import { getRequestSession } from "~/lib/auth/request-session.server";

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "EduAI Core Learning" },
    {
      name: "description",
      content:
        "An AI-powered learning platform built at UBC Okanagan — the project, its goals, and the research team behind it.",
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

const capabilities = [
  { icon: IconCpu, label: "Machine learning" },
  { icon: IconBook, label: "Educational technology" },
  { icon: IconUsers, label: "Personalized learning" },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteNavigation />

      {/* Hero */}
      <section className="border-b border-border py-20 lg:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid items-center gap-10 lg:grid-cols-[1fr_360px]">
            <div>
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

            <Card className="lg:self-stretch">
              <CardContent className="flex flex-col justify-center px-6 py-8">
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-[var(--radius-lg)] bg-primary/10">
                  <IconBulb className="h-6 w-6 text-primary-text" />
                </div>
                <h2 className="mb-3 text-lg font-semibold text-card-foreground">Our vision</h2>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {projectInfo.vision}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

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
                EduAI is a groundbreaking research initiative at UBC Okanagan that harnesses the
                power of artificial intelligence to transform educational experiences. Our project
                focuses on developing intelligent systems that understand, adapt, and respond to
                individual learning needs.
              </p>

              <p className="text-lg leading-relaxed text-muted-foreground">
                By combining advanced machine learning algorithms, natural language processing, and
                educational theory, we're creating tools that make learning more personalized,
                accessible, and effective for students across all disciplines.
              </p>

              <div className="flex flex-wrap gap-3">
                {capabilities.map(({ icon: Icon, label }) => (
                  <div
                    key={label}
                    className="flex items-center gap-2 rounded-full border border-border bg-muted px-4 py-2"
                  >
                    <Icon className="h-4 w-4 text-primary-text" />
                    <span className="text-sm font-medium text-foreground">{label}</span>
                  </div>
                ))}
              </div>
            </div>

            <Card>
              <CardContent className="px-6 py-6">
                <h3 className="mb-4 text-lg font-semibold text-card-foreground">
                  Built on the platform you're signing into
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  EduAI Core is the course-aware tutoring platform the lab builds and runs. Course
                  materials are embedded and retrieved to ground every answer, so students get help
                  anchored in what their instructor actually taught — not a generic model's guess.
                </p>
                <div className="mt-5">
                  <Button asChild variant="outline">
                    <Link to={siteConfig.navigation.dashboard}>
                      Open the dashboard
                      <IconArrowRight className="ml-1 h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <ProjectGoals />

      <TeamSection />

      {/* Closing CTA */}
      <section className="bg-primary py-20">
        <div className="mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-primary-foreground lg:text-4xl">
            Ready to get started?
          </h2>
          <div
            aria-hidden="true"
            className="mx-auto my-5 h-[3px] w-10 rounded-[2px] bg-[var(--gold)]"
          />
          <p className="mb-8 text-lg leading-relaxed text-primary-foreground/80">
            Head to your dashboard to pick up where you left off, or create an account to start
            learning with course-aware AI.
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
