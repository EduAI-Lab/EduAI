import { redirect } from "react-router";
import type { Route } from "./+types/home";
import { Link } from "react-router";
import { auth } from "~/lib/auth/server";
import { IconBrain, IconBook, IconUsers, IconBulb, IconArrowRight, IconCode, IconTerminal, IconCpu } from "@tabler/icons-react";
import { Button } from "@eduai/ui";
import { Card, CardContent } from "@eduai/ui";
import { AnimatedBackground } from "~/components/animated-background";
import { SiteHeader } from "~/components/site-header";
import { SiteFooter } from "~/components/site-footer";
import { ProjectGoals } from "~/components/project-goals";
import { projectInfo, siteConfig } from "~/config/site";
import { SiteNavigation } from "~/components/site-navigation";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "EduAI Core Learning" },
    { name: "description", content: "AI-powered learning platform" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await auth.api.getSession(request);

  if (session?.user) {
    return redirect("/dashboard");
  }

  return {};
}

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      <AnimatedBackground />
      <SiteNavigation currentPage="home" />

      {/* Hero Section */}
      <section className="relative py-20 lg:py-32">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <div className="flex justify-center mb-8">
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-green-400 to-blue-500 rounded-full blur-xl opacity-30 animate-pulse"></div>
                <div className="relative bg-gradient-to-r from-green-400 to-blue-500 p-6 rounded-full shadow-2xl">
                  <IconBrain className="h-16 w-16 text-white" />
                </div>
              </div>
            </div>

            <h1 className="text-5xl lg:text-7xl font-bold mb-6">
              <span className="bg-gradient-to-r from-green-400 via-blue-500 to-purple-600 bg-clip-text text-transparent animate-pulse">
                {projectInfo.title}
              </span>
            </h1>

            <div className="mb-8">
              <p className="text-xl lg:text-2xl text-foreground/70 mb-4 leading-relaxed">{projectInfo.subtitle}</p>
              <div className="flex justify-center items-center space-x-4 text-muted-foreground font-mono text-sm">
                <IconTerminal className="h-4 w-4" />
                <span>{"> python train_model.py --task=education --model=transformer"}</span>
              </div>
            </div>

            <p className="text-lg text-muted-foreground mb-12 max-w-3xl mx-auto">{projectInfo.description}</p>

            <Link
              to={siteConfig.navigation.team}
              className="bg-gradient-to-r from-green-500 to-blue-600 hover:from-green-600 hover:to-blue-700 text-white px-8 py-4 text-lg rounded-full shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105 border-0 inline-flex items-center"
            >
              <IconCode className="mr-2 h-5 w-5" />
              Meet our research team
              <IconArrowRight className="ml-2 h-5 w-5" />
            </Link>
          </div>
        </div>
      </section>

      {/* What is EduAI Section */}
      <section className="relative py-20 bg-card/50 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-foreground mb-4">What is {projectInfo.title}?</h2>
            <div className="w-24 h-1 bg-gradient-to-r from-green-400 to-blue-500 mx-auto rounded"></div>
          </div>

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
                <div className="flex items-center bg-green-500/20 border border-green-500/30 px-4 py-2 rounded-full backdrop-blur-sm">
                  <IconCpu className="h-5 w-5 text-green-400 mr-2" />
                  <span className="text-green-300 font-medium">Machine learning</span>
                </div>
                <div className="flex items-center bg-blue-500/20 border border-blue-500/30 px-4 py-2 rounded-full backdrop-blur-sm">
                  <IconBook className="h-5 w-5 text-blue-400 mr-2" />
                  <span className="text-blue-300 font-medium">Educational technology</span>
                </div>
                <div className="flex items-center bg-purple-500/20 border border-purple-500/30 px-4 py-2 rounded-full backdrop-blur-sm">
                  <IconUsers className="h-5 w-5 text-purple-400 mr-2" />
                  <span className="text-purple-300 font-medium">Personalized learning</span>
                </div>
              </div>
            </div>

            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-green-400/20 to-blue-500/20 rounded-2xl blur-xl"></div>
              <Card className="relative bg-card/80 backdrop-blur-sm border border-border shadow-2xl">
                <CardContent className="p-8">
                  <div className="text-center">
                    <div className="bg-gradient-to-r from-green-400 to-blue-500 p-4 rounded-full w-16 h-16 mx-auto mb-6 flex items-center justify-center">
                      <IconBulb className="h-8 w-8 text-white" />
                    </div>
                    <h3 className="text-2xl font-bold text-foreground mb-4">Our vision</h3>
                    <p className="text-muted-foreground leading-relaxed">{projectInfo.vision}</p>
                    <div className="mt-4 text-green-400 font-mono text-xs opacity-70">
                      {"// Building the future of education, one algorithm at a time"}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      <ProjectGoals />

      {/* CTA Section */}
      <section className="relative py-20 bg-gradient-to-r from-green-600/80 to-blue-600/80 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-4xl font-bold text-white mb-6">Ready to learn more?</h2>
          <p className="text-xl text-green-100 mb-8 leading-relaxed">
            Discover the brilliant minds behind EduAI and learn about their groundbreaking contributions to educational
            artificial intelligence research.
          </p>

          <Link
            to={siteConfig.navigation.team}
            className="bg-white/90 text-slate-800 hover:bg-white px-8 py-4 text-lg rounded-full shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105 inline-flex items-center"
          >
            <IconTerminal className="mr-2 h-5 w-5" />
            Explore our research team
            <IconArrowRight className="ml-2 h-5 w-5" />
          </Link>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
