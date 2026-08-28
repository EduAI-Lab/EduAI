import { IconDatabase, IconLeaf, IconCode, IconShieldCheck } from "@tabler/icons-react";
import { Card, CardContent, PageHeading } from "@eduai/ui";
import type { Icon } from "@tabler/icons-react";

interface Thread {
  icon: Icon;
  title: string;
  description: string;
}

/**
 * "Research at the lab" — replaces the earlier aspirational Project goals grid,
 * which described a mission rather than the work. These four threads are real:
 * pgvector-backed retrieval, energy-aware model routing measured by the GPU
 * sidecar, the FARD Lab's code LLM work, and AI Tutor's two-agent supervisor.
 * Anchored by the header/footer "Research" link (was "#goals").
 */
const threads: Thread[] = [
  {
    icon: IconDatabase,
    title: "Grounded retrieval",
    description:
      "Keeping an AI answering from course material instead of drifting into half-remembered training data. We store each course's content as vectors and retrieve the relevant passages for every question.",
  },
  {
    icon: IconLeaf,
    title: "Model routing for less energy",
    description:
      "Bigger models burn more power. We study how to route each question to the smallest model that can still answer it well, and measure what that saves with a GPU energy sidecar.",
  },
  {
    icon: IconCode,
    title: "Language models for code",
    description:
      "The FARD Lab works on large language models for programming languages, including low-resource ones. Better code understanding feeds back into how EduAI explains and debugs student code.",
  },
  {
    icon: IconShieldCheck,
    title: "Tutors that check their own work",
    description:
      "AI Tutor runs two models: one tutors, a second reviews the teaching before it reaches the student. We're testing whether that second pass catches confident-but-wrong answers a single model lets through.",
  },
];

export function ResearchSection() {
  return (
    <section id="research" className="relative scroll-mt-20 py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <PageHeading
          heading="Research at the lab"
          className="mb-12 text-center [&>div]:mx-auto"
          headingClassName="text-3xl lg:text-4xl font-bold text-foreground"
          subheading={
            <span className="mx-auto block max-w-3xl text-lg">
              EduAI is a product students use, and a testbed for how AI should behave in a classroom.
              A few of the threads the team is pulling on:
            </span>
          }
        />

        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-4">
          {threads.map((thread) => (
            <Card
              key={thread.title}
              className="border border-border bg-card transition-colors hover:border-primary/30 dark:hover:border-primary/45"
            >
              <CardContent className="p-6">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                  <thread.icon className="h-6 w-6 text-primary-text" />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-foreground">{thread.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {thread.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
