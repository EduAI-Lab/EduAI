import { IconBrain, IconTarget, IconCode, IconCpu, IconUsers, IconBulb, IconGitBranch, IconWorld } from "@tabler/icons-react";
import { Card, CardContent, PageHeading } from "@eduai/ui";

const goals = [
  {
    icon: IconBrain,
    title: "Patient, smart tutors",
    description:
      "AI companions that meet you where you are, explain tricky ideas step by step, and never get tired of questions.",
  },
  {
    icon: IconTarget,
    title: "Tailored study paths",
    description:
      "Practice sessions that adapt to what clicks for you, giving you extra support right where you need it most.",
  },
  {
    icon: IconCode,
    title: "Built in the open",
    description:
      "We share our code and research freely so teachers, students, and curious developers everywhere can build on it.",
  },
  {
    icon: IconCpu,
    title: "Helpful progress insights",
    description:
      "Clear, honest feedback showing where you are thriving and where a quick refresher could make a big difference.",
  },
  {
    icon: IconUsers,
    title: "Learning together",
    description:
      "Features designed to help classmates team up, bounce ideas around, and work through tough problems as a group.",
  },
  {
    icon: IconWorld,
    title: "Accessible to everyone",
    description:
      "Fast, lightweight tools designed to run smoothly for anyone, anywhere, across all kinds of devices.",
  },
  {
    icon: IconBulb,
    title: "Curiosity first",
    description:
      "Real classroom experiments driven by students and professors who love testing fresh ideas and learning.",
  },
  {
    icon: IconGitBranch,
    title: "Plays well with your classes",
    description:
      "Connects naturally with platforms you already use every day, like Canvas, without adding extra hassle.",
  },
];

export function ProjectGoals() {
  return (
    <section id="goals" className="relative scroll-mt-20 py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <PageHeading
          heading="Project goals"
          className="text-center mb-16 [&>div]:mx-auto"
          headingClassName="text-3xl lg:text-4xl font-bold text-foreground"
        />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {goals.map((goal, index) => (
            <Card
              key={index}
              className="bg-card border border-border hover:border-primary/50 transition-colors"
            >
              <CardContent className="p-6">
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <goal.icon className="h-6 w-6 text-primary-text" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  {goal.title}
                </h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {goal.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
