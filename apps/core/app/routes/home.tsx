import { redirect } from "react-router";
import type { Route } from "./+types/home";
import { Link } from "react-router";
import { IconBrain, IconBook, IconUsers, IconBulb, IconArrowRight, IconCpu } from "@tabler/icons-react";
import { Button, Card, CardContent, PageHeading } from "@eduai/ui";
import { SiteFooter } from "~/components/site-footer";
import { ProjectGoals } from "~/components/project-goals";
import { projectInfo, siteConfig } from "~/config/site";
import { SiteNavigation } from "~/components/site-navigation";
import { getRequestSession } from "~/lib/auth/request-session.server";

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "EduAI Core Learning" },
    { name: "description", content: "AI-powered learning platform" },
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
      <SiteNavigation currentPage="home" />

      {/* Hero Section */}
      <section className="py-20 lg:py-32">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <div className="flex justify-center mb-8">
              <div className="bg-primary p-6 rounded-full shadow-lg">
                <IconBrain className="h-16 w-16 text-primary-foreground" />
              </div>
            </div>

            <h1 className="text-5xl lg:text-7xl font-bold mb-6 text-foreground">{projectInfo.title}</h1>

            <p className="text-xl lg:text-2xl text-muted-foreground mb-8 leading-relaxed">{projectInfo.subtitle}</p>

            <p className="text-lg text-muted-foreground max-w-3xl mx-auto">{projectInfo.description}</p>
          </div>
        </div>
      </section>

      {/* What is EduAI Section */}
      <section className="py-20 bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <PageHeading
            heading={`What is ${projectInfo.title}?`}
            className="text-center mb-16 [&>div]:mx-auto"
            headingClassName="text-4xl font-bold text-foreground"
          />

          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-lg text-muted-foreground leading-relaxed mb-6">
                EduAI is a groundbreaking research initiative at UBC Okanagan that harnesses the power of artificial
                intelligence to transform educational experiences. Our project focuses on developing intelligent systems
                that understand, adapt, and respond to individual learning needs.
              </p>

              <p className="text-lg text-muted-foreground leading-relaxed mb-8">
                By combining advanced machine learning algorithms, natural language processing, and educational theory,
                we're creating tools that make learning more personalized, accessible, and effective for students across
                all disciplines.
              </p>

              <div className="flex flex-wrap gap-4">
                <div className="flex items-center bg-primary/10 border border-primary/20 px-4 py-2 rounded-full">
                  <IconCpu className="h-5 w-5 text-primary-text mr-2" />
                  <span className="text-primary-text font-medium">Machine learning</span>
                </div>
                <div className="flex items-center bg-accent/10 border border-accent/20 px-4 py-2 rounded-full">
                  <IconBook className="h-5 w-5 text-accent mr-2" />
                  <span className="text-foreground font-medium">Educational technology</span>
                </div>
                <div className="flex items-center bg-secondary/10 border border-secondary/20 px-4 py-2 rounded-full">
                  <IconUsers className="h-5 w-5 text-secondary mr-2" />
                  <span className="text-foreground font-medium">Personalized learning</span>
                </div>
              </div>
            </div>

            <Card className="bg-background border border-border shadow-lg">
              <CardContent className="p-8">
                <div className="text-center">
                  <div className="bg-primary p-4 rounded-full w-16 h-16 mx-auto mb-6 flex items-center justify-center">
                    <IconBulb className="h-8 w-8 text-primary-foreground" />
                  </div>
                  <h3 className="text-2xl font-bold text-foreground mb-4">Our vision</h3>
                  <p className="text-muted-foreground leading-relaxed">{projectInfo.vision}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <ProjectGoals />

      {/* CTA Section */}
      <section className="py-20 bg-primary">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-4xl font-bold text-primary-foreground mb-6">Ready to learn more?</h2>
          <p className="text-xl text-primary-foreground/80 mb-8 leading-relaxed">
            Discover the brilliant minds behind EduAI and learn about their groundbreaking contributions to educational
            artificial intelligence research.
          </p>

          <Button asChild size="lg" variant="gold">
            <Link to={siteConfig.navigation.team}>
              Explore our research team
              <IconArrowRight className="ml-2 h-5 w-5" />
            </Link>
          </Button>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
