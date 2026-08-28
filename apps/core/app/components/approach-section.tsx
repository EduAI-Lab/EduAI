import { IconTarget, IconServer, IconPlugConnected, IconAccessible } from "@tabler/icons-react";
import { Card, CardContent, PageHeading } from "@eduai/ui";
import type { Icon } from "@tabler/icons-react";

interface Pillar {
  icon: Icon;
  title: string;
  description: string;
}

/**
 * "What makes EduAI different" — sits between the About and Products sections of
 * the single-scroll landing page. Four concrete claims about how the platform is
 * built, each tied to something the code actually does (RAG grounding, the campus
 * vLLM fleet, the Core-plus-extensions model, and Assistive Mode). Uses the same
 * card grid and shared tokens as Project research so it follows the theme toggle.
 */
const pillars: Pillar[] = [
  {
    icon: IconTarget,
    title: "Answers grounded in your course",
    description:
      "Upload your slides, readings, and syllabus. Retrieval pulls the relevant passages into every answer, so the tutor works from your professor's material and cites where it came from.",
  },
  {
    icon: IconServer,
    title: "Your coursework stays on campus",
    description:
      "The models run on UBC Okanagan's own GPU fleet. Your questions and uploaded files stay on university hardware rather than going to a commercial provider or into someone else's training data.",
  },
  {
    icon: IconPlugConnected,
    title: "One account across every tool",
    description:
      "EduAI owns sign-in, courses, and the shared model layer. AI Tutor and Question Maker read straight from it, so an instructor sets up a course once, and every tool already knows the roster, the materials, and the Canvas sync.",
  },
  {
    icon: IconAccessible,
    title: "Built for how different people study",
    description:
      "ADHD Assist mode shortens and paces responses for students who turn it on, and the interface adapts per account.",
  },
];

export function ApproachSection() {
  return (
    <section id="approach" className="scroll-mt-20 border-t border-border py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <PageHeading
          heading="What makes EduAI different"
          className="mb-12 text-center [&>div]:mx-auto"
          headingClassName="text-3xl lg:text-4xl font-bold text-foreground"
          subheading={
            <span className="mx-auto block max-w-3xl text-lg">
              Your course comes first. Every answer draws on the material you upload, and the models
              run on hardware the university controls.
            </span>
          }
        />

        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          {pillars.map((pillar) => (
            <Card
              key={pillar.title}
              className="border border-border bg-card transition-colors hover:border-primary/30 dark:hover:border-primary/45"
            >
              <CardContent className="p-6">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                  <pillar.icon className="h-6 w-6 text-primary-text" />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-foreground">{pillar.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {pillar.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
