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
        "An AI learning platform crafted at UBC Okanagan. Discover what we are building, why we love doing it, and meet the team behind it all.",
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
  { icon: IconCpu, label: "Smart course AI" },
  { icon: IconBook, label: "Real class notes" },
  { icon: IconUsers, label: "Personalized practice" },
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
                We are a research lab at UBC Okanagan building learning tools that feel genuinely
                helpful. Instead of handing you the answer or replacing great teachers,
                our tools break down confusing topics step by step, and meet
                you wherever you are in your coursework.
              </p>

              <p className="text-lg leading-relaxed text-muted-foreground">
                By mixing machine learning research with real classroom feedback, we build software
                that students actually want to use. Whether you are untangling difficult code, reviewing
                lecture slides before an exam, or exploring new ideas, we want studying to feel less
                daunting and more accessible.
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
                  Powered by the platform right here
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  EduAI Core is our home-grown tutoring platform. It connects directly with your
                  course slides, readings, and syllabi so every answer is anchored in what your
                  professor actually taught, rather than random guesses from the open web.
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
            Ready to dive in?
          </h2>
          <div
            aria-hidden="true"
            className="mx-auto my-5 h-[3px] w-10 rounded-[2px] bg-[var(--gold)]"
          />
          <p className="mb-8 text-lg leading-relaxed text-primary-foreground/80">
            Jump into your dashboard to continue your studies, or set up a free account and try out
            an AI tutor that actually knows your syllabus.
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
